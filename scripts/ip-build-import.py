#!/usr/bin/env python3
"""Supabase 에서 뽑아낸 ip 스키마 데이터를 Omnis DB 용 INSERT 문으로 바꾼다.

    python3 scripts/ip-build-import.py <export.json> [audit.json] > import.sql

왜 SQL 파일로 만드나: 옮길 값에 text[]·jsonb·date 가 섞여 있어 ORM 을 거치면
타입이 한 번 더 번역된다. 원본과 같은 리터럴을 그대로 넣는 편이 확인하기 쉽다.

사용자 참조는 uuid 를 그대로 옮기지 않고 **이름으로 Omnis 계정을 찾는 부속질의**로
바꾼다. Supabase 의 auth.users 와 Omnis 의 User 는 서로 모르는 표라 uuid 가 겹치지
않고, 로컬 DB 와 Neon 의 시드 uuid 도 서로 다르기 때문이다. 이름으로 찾으면 같은
SQL 이 두 곳 모두에서 맞는 사람을 가리킨다.
"""
import json
import sys

# Supabase auth.users 의 uuid → Omnis User.name
#
# 확인한 근거: ip.members 2행이 전부이고 (woochang4862@gmail.com=정우창,
# hyerinnoh@haddscience.com=노혜린), 두 이름 모두 Omnis 구성원 7명에 있다.
# 업무 데이터의 updated_by 는 122행 전부 NULL 이라 옮길 것이 없다.
ACTOR_BY_NAME = {
    "c8ca526d-9094-49cf-a709-d949a6caf9f3": "정우창",
    "c597dcd2-951e-400d-a95f-19f42ab89a5e": "노혜린",
}

# 어느 컬럼이 사람을 가리키는가
USER_COLUMNS = {"user_id", "updated_by", "resolved_by", "actor", "decided_by"}

# 배열 컬럼 (json 리스트 → ARRAY[...]::text[])
ARRAY_COLUMNS = {"classes", "attachments", "redirect_uris"}

# jsonb 컬럼
JSON_COLUMNS = {"firm", "stage_order", "before", "after"}

# FK 를 거스르지 않는 적재 순서
ORDER = [
    "status_options",
    "members",
    "trademarks",
    "patents",
    "opening_state",
    "progress_entries",
    "communications",
    "communication_links",
    "actions",
    "integrity_flags",
    "org_meta",
    "member_prefs",
    "audit_log",
]


def lit(value) -> str:
    """파이썬 값을 SQL 리터럴로."""
    if value is None:
        return "NULL"
    if value is True:
        return "TRUE"
    if value is False:
        return "FALSE"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def render(column: str, value) -> str:
    if column in USER_COLUMNS and value is not None:
        name = ACTOR_BY_NAME.get(value)
        if name is None:
            # 모르는 사람이면 비운다. 옛 uuid 를 그대로 남기면 Omnis 에 없는
            # 사람을 가리키는 외래키가 되어 적재 자체가 막힌다.
            return "NULL"
        return f"(SELECT id FROM public.\"User\" WHERE name = {lit(name)})"

    if column in ARRAY_COLUMNS:
        items = value or []
        if not items:
            return "'{}'::text[]"
        return "ARRAY[" + ", ".join(lit(i) for i in items) + "]::text[]"

    if column in JSON_COLUMNS and value is not None:
        return lit(json.dumps(value, ensure_ascii=False)) + "::jsonb"

    return lit(value)


def main() -> None:
    payload: dict[str, list[dict]] = {}
    for path in sys.argv[1:]:
        payload.update(json.load(open(path, encoding="utf-8")))

    out = sys.stdout
    out.write("-- 자동 생성 (scripts/ip-build-import.py). 손으로 고치지 말 것.\n")
    out.write("BEGIN;\n\n")

    out.write("-- 적재 중에는 트리거를 끈다.\n")
    out.write("-- 켠 채로 넣으면 progress_entries 하나하나가 apply_progress_entry 를\n")
    out.write("-- 깨워 방금 넣은 상표·특허를 다시 계산해 버린다. 옮기는 것은 원본\n")
    out.write("-- 그대로여야 하므로, 계산은 적재가 끝난 뒤 rebuild_ledger 로 검증한다.\n")
    out.write("-- 감사 트리거도 마찬가지다 — 이사가 편집으로 기록되면 안 된다.\n")
    for table in ORDER:
        out.write(f"ALTER TABLE ip.{table} DISABLE TRIGGER USER;\n")
    out.write("\n")

    # 다시 돌려도 같은 결과가 되도록 비우고 시작한다.
    for table in reversed(ORDER):
        out.write(f"DELETE FROM ip.{table};\n")
    out.write("\n")

    total = 0
    for table in ORDER:
        rows = payload.get(table) or []
        if not rows:
            out.write(f"-- ip.{table}: 옮길 행 없음\n\n")
            continue
        columns = list(rows[0].keys())
        cols = ", ".join(f'"{c}"' for c in columns)
        out.write(f"-- ip.{table}: {len(rows)}행\n")
        out.write(f"INSERT INTO ip.{table} ({cols}) VALUES\n")
        values = [
            "  (" + ", ".join(render(c, row.get(c)) for c in columns) + ")"
            for row in rows
        ]
        out.write(",\n".join(values))
        out.write(";\n\n")
        total += len(rows)

    if payload.get("audit_log"):
        out.write("-- 시퀀스를 마지막 id 다음으로 맞춘다\n")
        out.write("SELECT setval('ip.audit_log_id_seq', (SELECT max(id) FROM ip.audit_log));\n\n")

    for table in ORDER:
        out.write(f"ALTER TABLE ip.{table} ENABLE TRIGGER USER;\n")

    out.write("\nCOMMIT;\n")
    print(f"-- 합계 {total}행", file=sys.stderr)


if __name__ == "__main__":
    main()
