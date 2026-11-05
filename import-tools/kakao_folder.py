# kakao-sync.py 의 판단만 모은 곳 — 카톡 · AppKit 없이 시험한다(import-tools/test_kakao_folder.py).
import csv, hashlib, json, re, time, unicodedata
from datetime import date, datetime, timedelta

REPORT_PREFIX = "@@kakao-report "
nfc = lambda s: unicodedata.normalize("NFC", s)


class FolderError(Exception):
    """폴더 목록을 믿을 수 없다 — 한 방도 건드리지 않고 멈춘다."""


def safe_key(name):
    """방 키 — CSV 파일 이름과 폴더 이름에 들어간다. 길면 잘라 해시를 붙인다."""
    key = nfc(name).replace("/", "_").strip()
    if len(key.encode()) <= 160:
        return key
    return key.encode()[:140].decode(errors="ignore").rstrip() + "-" + hashlib.sha1(key.encode()).hexdigest()[:8]


def room_key(list_name, rooms):
    """채팅 목록 이름 → 설정의 방 키. 이름 없는 단체방은 CSV 이름이 모두 같으므로 목록 이름으로 가른다."""
    name = nfc(list_name)
    for key, room in rooms.items():
        if room.get("listName") and nfc(room["listName"]) == name:
            return key
    return name if name in rooms else safe_key(name)


def csv_room(path_name):
    m = re.match(r"^KakaoTalk_Chat_(.+)_(\d{4}(?:-\d{2}){5})\.csv$", nfc(path_name))
    return (m.group(1), m.group(2)) if m else (None, None)


def csv_name_for(key, path_name):
    """kakao.ts 는 파일 이름에서 방을 읽는다. 방 키와 다르면 그 키로 이름을 고친다."""
    room, stamp = csv_room(path_name)
    if room is None:
        raise ValueError(f"카톡 CSV 이름이 아니다: {path_name}")
    return nfc(path_name) if room == key else f"KakaoTalk_Chat_{key}_{stamp}.csv"


def check_folder(names, rooms, folder, max_rooms, max_new):
    """폴더를 잘못 읽으면 사적인 방까지 운영에 들어간다. 조금이라도 이상하면 전부 멈춘다."""
    names = [nfc(n) for n in names]
    if not names:
        raise FolderError(f"「{folder}」 폴더에 방이 없다 — 폴더 탭을 못 열었을 수 있다")
    if len(names) > max_rooms:
        raise FolderError(f"방이 {len(names)}개라 「{folder}」 폴더가 아닌 듯하다 (상한 {max_rooms}, --max-rooms)")
    keys = [room_key(n, rooms) for n in names]
    known = [k for k in keys if k in rooms]
    if rooms and not known:
        raise FolderError(f"목록에 아는 방이 하나도 없어 「{folder}」 폴더가 아닌 듯하다")
    new = [k for k in keys if k not in rooms]
    if len(new) > max_new:
        raise FolderError(f"새 방이 {len(new)}개다 (상한 {max_new}, --max-new-rooms). 폴더를 확인한 뒤 상한을 올려 돌린다")
    return names


def switch_to_folder(click_all, click_folder, count, max_rooms, tries=3, wait=5.0, sleep=time.sleep):
    """폴더 탭 전환을 행 수로 확인한다. 카톡이 뒤에 있으면 클릭이 창 앞으로 가져오는 데만 쓰여 탭이 그대로일 수 있다.
    접근성으로는 어느 탭이 선택됐는지 알 수 없어(AXSelected 가 모두 거짓), 전체 탭(행이 많다)을 거쳐 폴더 탭(행이 적다)으로 간다.
    클릭이 들으면 행 수는 0.1초 안에 바뀐다(2026-11-04 실측)."""
    def settle(click, ok, what):
        for _ in range(tries):
            click()
            for _ in range(int(wait / 0.2)):
                if ok(count()):
                    return
                sleep(0.2)
        raise FolderError(f"{what} 탭으로 바뀌지 않았다 (지금 {count()}행)")
    settle(click_all, lambda n: n > max_rooms, "전체")
    settle(click_folder, lambda n: n <= max_rooms, "폴더")


def duplicates(names):
    """이름이 같은 방은 어느 쪽인지 가를 수 없으므로 처리하지 않는다."""
    seen, dup = set(), set()
    for n in map(nfc, names):
        (dup if n in seen else seen).add(n)
    return dup


def parse_report(lines):
    for line in reversed(list(lines)):
        if line.startswith(REPORT_PREFIX):
            return json.loads(line[len(REPORT_PREFIX):])
    return None


def env_fingerprint(room_config, exclude_bytes):
    """CSV 말고 이식 결과를 바꾸는 입력 — 방 설정과 제외 목록. 바뀌면 CSV 가 같아도 다시 돌린다."""
    text = json.dumps(room_config, ensure_ascii=False, sort_keys=True).encode()
    return hashlib.sha256(text + b"\0" + exclude_bytes).hexdigest()


def leftovers(report):
    """이번 실행이 남긴 일. 보고가 없으면 끝났는지 모르므로 남은 것으로 본다."""
    if not report or "leftover" not in report:
        return {"unknown": 1}
    return {k: v for k, v in report["leftover"].items() if v}


def can_skip(room_state, csv_digest, env, got):
    """kakao.ts 를 돌리지 않아도 놓치는 것이 없는가.
    - 새 글: CSV 가 지난번 완료 때와 같아야 한다. 완료 표시는 남은 일이 없을 때만 남는다(remember_import)
      — 분류 실패 · 카드 라운드 실패 · 사진 설명 · 사진 색인 실패는 CSV 가 그대로여도 재시도되어야 하기 때문이다.
    - 새 사진: 이번에 받았거나, 건식 · --no-import 로 받아만 두고 아직 안 넣은 것이 없어야 한다.
    - 방 설정 · 제외 목록: 같아야 한다. 표시가 없으면(이 기능 전의 완료 기록) 같은 것으로 본다."""
    st = room_state or {}
    if got or st.get("mediaPending") or st.get("importedCsv") != csv_digest:
        return False
    return st.get("importedEnv") in (None, env)


def remember_import(room_state, csv_digest, env, report):
    """운영 이식이 끝난 뒤의 상태. 남은 일이 있으면 완료 표시를 지워 다음 실행에서 다시 돌린다."""
    st = dict(room_state or {})
    left = leftovers(report)
    if left:
        st.pop("importedCsv", None)
        st.pop("importedEnv", None)
    else:
        st.update(importedCsv=csv_digest, importedEnv=env)
        st.pop("mediaPending", None)
    # 받지 못한 파일이 남았으면 CSV 가 그대로여도 이 방을 건너뛰지 않는다
    if (st.get("files") or {}).get("pending"):
        st["mediaPending"] = True
    return st, left


def summary(results, failed, not_started, dry, files=None):
    """실행 보고 — results: [{room, inserted, pending, newRoom, newExternals, newMembers, skipped}] · files: {방: file_report 값}"""
    verb = "넣을 글" if dry else "넣은 글"
    out = [f"── 실행 보고{' (건식)' if dry else ''} ──"]
    for r in results:
        n = "같은 CSV — 건너뜀" if r.get("skipped") else f"{verb} {r.get('pending' if dry else 'inserted', 0)}건"
        if r.get("elapsed") is not None:
            n += f" · {r['elapsed']}초"
        out.append(f"  {r['room']}: {n}")
    new_rooms = [r["room"] for r in results if r.get("newRoom")]
    externals = sorted({e for r in results for e in r.get("newExternals", [])})
    members = [f"{r['room']} + {', '.join(r['newMembers'])}" for r in results if r.get("newMembers")]
    out.append(f"  새 방 {len(new_rooms)}: {', '.join(new_rooms) or '없음'}")
    out.append(f"  새 외부 발화자 {len(externals)}: {', '.join(externals) or '없음'}")
    if members:
        out.append(f"  참여자 추가: {' · '.join(members)}")
    left = [f"{r['room']} ({', '.join(f'{k} {v}' for k, v in leftovers(r).items())})" for r in results if not r.get("skipped") and leftovers(r)]
    if left and not dry:
        out.append(f"  다음 실행에서 다시 돌릴 방 {len(left)}: {' · '.join(left)}")
    out.append(f"  실패 방 {len(failed)}: {' · '.join(f'{k} ({v})' for k, v in failed.items()) or '없음'}")
    if not_started:
        out.append(f"  시작 못 한 방 {len(not_started)}: {', '.join(not_started)}")
    if files:
        out.extend(file_summary(files, dry))
    return "\n".join(out)


# ── 파일 탭 ─────────────────────────────────────────────
# 서랍 「파일」 칸에는 이름 · 만료일 · 크기가 있다(2026-11-05 실측). 사진과 달리 이름으로 짝지을 수 있어 칸 수 차이에 기대지 않는다.

FILE_RETENTION_DAYS = 14  # 서랍의 만료일 = 보낸 날 + 14일 (2026-11-05 실측)
FILE_MAX_BYTES = 300 * 1024 * 1024  # lib/constants.ts ATTACH_MAX_BYTES 와 같게 둔다. 앱의 큰 첨부 플래그와는 무관하다
FILE_MAX_TRIES = 5
DELETED_TEXT = "The message has been deleted"
UNITS = {"B": 1, "KB": 1024, "MB": 1024 ** 2, "GB": 1024 ** 3}


def file_lines(csv_path):
    """CSV 의 파일 줄 — [{t, name, deleted, multi}] 오래된 것 먼저. 삭제된 글도 줄 수에는 들어간다(기준점이 흔들리지 않게)."""
    out = []
    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        for row in csv.reader(f):
            if len(row) < 3 or not re.match(r"\d{4}-\d{2}-\d{2} ", row[0]) or not row[2].startswith("File: "):
                continue
            first, _, rest = row[2][6:].strip().partition("\n")
            out.append({"t": row[0], "name": nfc(first.strip()), "deleted": DELETED_TEXT in rest, "multi": bool(rest) and DELETED_TEXT not in rest})
    return out


def excluded_file_times(exclude, room):
    """제외 목록의 파일 줄 → {(시각, 이름)}. 제외된 글의 파일은 받지 않는다."""
    out = set()
    for e in exclude:
        m = e.get("m") or ""
        if e.get("room") == room and e.get("t") and m.startswith("File: "):
            out.add((e["t"], nfc(m[6:].partition("\n")[0].strip())))
    return out


def file_baseline(room_files, lines, prev_count):
    """받기 시작할 줄 번호. 기록이 없으면 지난 실행의 CSV 줄 수(그 뒤에 온 것만), 그 CSV 도 없으면 지금 줄 수."""
    if room_files is not None:
        return room_files["seen"]
    return len(lines) if prev_count is None else min(prev_count, len(lines))


def parse_size(text):
    """「65.7KB」 → 바이트. 읽지 못하면 None."""
    m = re.fullmatch(r"([\d,.]+)\s*(B|KB|MB|GB)", (text or "").strip())
    return float(m.group(1).replace(",", "")) * UNITS[m.group(2)] if m else None


def size_matches(label, actual):
    """서랍 글자는 소수 한 자리까지다 — 그 반올림 오차 안이면 같은 파일이다."""
    m = re.fullmatch(r"[\d,.]+\s*(B|KB|MB|GB)", (label or "").strip())
    if not m:
        return False
    return abs(parse_size(label) - actual) <= (0 if m.group(1) == "B" else 0.06 * UNITS[m.group(1)])


def parse_expiry(text):
    """「Expiry: 11/19/2026」 → date. 없으면 None."""
    m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", text or "")
    return date(int(m.group(3)), int(m.group(1)), int(m.group(2))) if m else None


def saved_name_ok(saved, wanted):
    """카톡은 같은 이름이 있으면 「이름 (1).확장자」 로 저장한다. 그 밖의 새 파일은 사람이 받은 것일 수 있다."""
    saved, wanted = nfc(saved), nfc(wanted)
    stem, dot, ext = wanted.rpartition(".")
    if not dot:
        stem, ext = wanted, ""
    pattern = re.escape(stem) + r"(?: \(\d+\))?" + (r"\." + re.escape(ext) if dot else "")
    return re.fullmatch(pattern, saved) is not None


def file_stamp_dir(t, taken):
    """받은 파일을 둘 폴더 이름 — 보낸 시각. 같은 초에 같은 이름이 또 오면 번호를 붙인다. 이름은 원래대로 둔다."""
    base = datetime.strptime(t, "%Y-%m-%d %H:%M:%S").strftime("%Y%m%d_%H%M%S")
    name, n = base, 1
    while name in taken:
        n += 1
        name = f"{base}_{n}"
    return name


def plan_files(todo, lines, items, today, excluded=frozenset()):
    """받을 것을 정한다.
    todo: 받을 줄 [{t, name, tries?}] · lines: CSV 의 파일 줄 전부 · items: 서랍 칸 최신순 [{name, expiry, size}]
    같은 이름은 최신순 k 번째 줄 ↔ 최신순 k 번째 칸으로 짝짓고, 만료일이 보낸 날 + 14일(±1일)과 맞아야 한다.
    돌려주는 값: {get: [(줄, 칸)], wait: [줄], gone: [(줄, 까닭)]}
    wait 는 다음 실행에서 다시 보고, gone 은 더 받을 수 없어 목록에서 뺀다."""
    live = [l for l in lines if not l.get("deleted") and (l["t"], l["name"]) not in excluded]
    by_name = {}
    for l in sorted(live, key=lambda x: x["t"], reverse=True):
        by_name.setdefault(l["name"], []).append(l["t"])
    slots = {}
    for it in items:
        slots.setdefault(nfc(it["name"]), []).append(it)
    plan = {"get": [], "wait": [], "gone": []}
    for line in todo:
        name, t = line["name"], line["t"]
        sent = datetime.strptime(t, "%Y-%m-%d %H:%M:%S").date()
        if (t, name) in excluded:
            plan["gone"].append((line, "제외 목록"))
        elif not any(l["t"] == t and l["name"] == name for l in live):
            plan["gone"].append((line, "삭제된 글"))
        elif line.get("multi"):
            plan["gone"].append((line, "자리표시 꼴이 다름"))
        elif line.get("tries", 0) >= FILE_MAX_TRIES:
            plan["gone"].append((line, f"{FILE_MAX_TRIES}번 실패"))
        else:
            k = by_name[name].index(t)
            cands = slots.get(name, [])
            item = cands[k] if k < len(cands) else None
            size = parse_size(item.get("size")) if item else None
            if item is None:
                expired = today > sent + timedelta(days=FILE_RETENTION_DAYS + 1)
                plan["gone" if expired else "wait"].append((line, "만료") if expired else line)
            elif item.get("expiry") is None or abs((item["expiry"] - (sent + timedelta(days=FILE_RETENTION_DAYS))).days) > 1:
                plan["wait"].append(line)  # CSV 를 내보낸 뒤 같은 이름이 또 왔거나 칸이 빠졌다 — 틀린 파일보다 빈칸이 낫다
            elif item["expiry"] < today:
                plan["gone"].append((line, "만료"))
            elif size is None:
                plan["wait"].append(line)
            elif size > FILE_MAX_BYTES:
                plan["gone"].append((line, "300MB 초과"))
            else:
                plan["get"].append((line, item))
    return plan


def dedupe_scrolled(items):
    """서랍을 굴리는 동안 겹쳐 읽은 칸을 뺀다. 칸에는 고유한 값이 없어 이름 · 만료일 · 크기로 가른다.
    셋이 모두 같은 칸은 하나로 줄어 뒤의 줄이 대기로 남는다 — 어느 칸인지 가를 수 없으므로 그렇게 둔다."""
    seen, out = set(), []
    for it in items:
        key = (it["name"], it["expiry"], it["size"])
        if key not in seen:
            seen.add(key)
            out.append(it)
    return out


def file_report(got=0, wait=0, gone=None, listed=None, oldest=None, newest=None):
    return {"got": got, "wait": wait, "gone": gone or [], "listed": listed or [], "oldest": oldest, "newest": newest}


def file_summary(files, dry):
    """실행 보고의 파일 줄. 건식은 받을 목록을 그대로 보여 준다."""
    total = sum(len(r["listed"]) for r in files.values()) if dry else sum(r["got"] for r in files.values())
    times = [t for r in files.values() for t in (r["oldest"], r["newest"]) if t]
    span = f" ({min(times)[:16]} ~ {max(times)[:16]})" if times else ""
    out = [f"  {'받을' if dry else '받은'} 파일 {total}개{span}"]
    for room, r in files.items():
        parts = []
        if dry and r["listed"]:
            parts.append(f"받을 {len(r['listed'])}")
        if not dry and r["got"]:
            parts.append(f"받음 {r['got']}")
        if r["wait"]:
            parts.append(f"다음에 다시 {r['wait']}")
        if r["gone"]:
            parts.append(f"못 받음 {len(r['gone'])} ({', '.join(sorted(set(r['gone'])))})")
        if parts:
            out.append(f"    {room}: {' · '.join(parts)}")
        for name, size, t in r["listed"]:
            out.append(f"      - {t[:16]} {size} {name}")
    return out
