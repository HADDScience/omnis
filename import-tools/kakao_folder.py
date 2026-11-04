# kakao-sync.py 의 판단만 모은 곳 — 카톡 · AppKit 없이 시험한다(import-tools/test_kakao_folder.py).
import hashlib, json, re, time, unicodedata

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
    return st, left


def summary(results, failed, not_started, dry):
    """실행 보고 — results: [{room, inserted, pending, newRoom, newExternals, newMembers, skipped}]"""
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
    return "\n".join(out)
