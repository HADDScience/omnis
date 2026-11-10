---
kind: decision
status: active
canonical: mydocs/tech/ip-schema.md
last_verified: 2026-10-28
---

# 지식재산권 — 출원일 오채움 고치기 · 날짜 정정

상표권 세션에서 넘어온 작업. 작업지시자 요청(2026-10-28): 원인 보고 → 수정 → PR.

## 증상

1. PT-05·06 (단계 `출원`, `filed_on` 비어 있음)에 10-26 「출원」 메일 기록을 남기자
   `filed_on` 이 2026-10-26 이 됐다. 실제 출원일은 2025-10-17.
2. 출원일·등록일을 고칠 길이 없다 — `correct_ip` 에도 웹 정정 양식에도 칸이 없다.

## 원인

`ip.apply_progress_entry` · `ip.rebuild_ledger` 의 latch 규칙
(`prisma/migrations/20260902040000_ip_schema/migration.sql:402-403, 432-433, 497-502`):

```sql
filed_on = case when moves and new.stage = '출원' then coalesce(filed_on, new.occurred_on) else filed_on end
```

단계가 「출원」인 기록이면 **이미 출원 단계인 건의 후속 기록**도 비어 있는 출원일을 채운다.
개시 스냅샷이 `출원` 단계 + 출원일 없음으로 시작한 건(PT-05·06)이 정확히 그 경우다.
등록일도 같은 구조다(MCP 지침 8번이 「등록 건에 등록 기록을 남기면 등록일이 된다」고 이 함정을 피해 가라고 적어 둔 것).

## 고치는 것

| 단계 | 내용 |
|---|---|
| 1 | 마이그레이션: latch 를 **단계가 바뀌는 기록**에서만(`status is distinct from new.stage`). 재계산도 같은 규칙 |
| 2 | 마이그레이션: `progress_entries.filed_on`·`registered_on` (text — `NULL`=그대로, `''`=비움, `YYYY-MM-DD`=그 값). 명시값은 `newer`·`moves` 와 무관하게 언제나 반영 |
| 3 | `correctRecord`·`/api/ip/corrections`·MCP `correct_ip` 에 `filedOn`·`registeredOn`. 지침 8번 문구와 확인 코드 갱신 |
| 4 | 웹(ip-platform) 정정 양식에 출원일·등록일 칸 |
| 5 | 운영: `db:deploy` → 머지 → 데이터 정정 4건(작업지시자 승인 뒤) |

## 왜 date 가 아니라 text 인가

정정의 핵심 약속이 「`NULL`=안 바꿈, `''`=비움」이다(`app_no`·`reg_no` 와 같다).
date 칸에는 빈 문자열이 없어 「비우기」를 표현할 수 없다. 형식은 CHECK 로 막는다.

## 넣지 않은 것

- `add_progress` 에 날짜 칸 — 진행 기록의 날짜가 곧 출원일인 경우는 1 의 규칙으로 맞게 채워진다.
  틀린 값을 고치는 일은 정정의 몫이다.
- 기존 데이터 일괄 재계산(`rebuild_ledger`) — 운영에 같은 증상이 더 있는지는 롤백 트랜잭션으로 견줘 본 뒤 정한다.
