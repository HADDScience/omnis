#!/usr/bin/env python3
# 카톡 Mac 앱에서 대화 CSV 와 새로 올라온 사진을 받아 kakao.ts 로 옴니스에 이식한다.
#
#   python3 import-tools/kakao-sync.py                       두 방을 지금 돌린다 (로컬 DB)
#   python3 import-tools/kakao-sync.py --target prod         프로덕션에 이식
#   python3 import-tools/kakao-sync.py --when-idle 10        10분 넘게 입력이 없고 화면이 잠기지 않았을 때만
#   python3 import-tools/kakao-sync.py --no-import           받기만 하고 이식은 하지 않는다
#   python3 import-tools/kakao-sync.py --dry                 카톡에서 받고, 이식은 임시 폴더에서 건식으로만
#   python3 import-tools/kakao-sync.py --from-csv DIR --target prod   카톡을 건드리지 않고 그 폴더의 CSV 로 건식만
#
# 방은 import-config.json 의 syncFolder(카톡 채팅 폴더)에서 실행마다 읽는다 — 폴더에 있는 방은 전부 옮긴다. 처음 보는 방은
# kakao.ts --auto-rooms 가 참여자 전용으로 등록한다(rooms-config.ts registerRoom). 한 방이 실패해도 나머지는 진행한다.
#
# 사진은 「채팅방 서랍 → 사진/동영상」 에서 받는다. 보관함은 최신순이고 항목에 날짜가 없다.
# 그래서 지난 실행 때의 보관함 개수와 CSV 사진 자리표시 개수를 state.json 에 적어 두고,
# 둘 다 늘어난 만큼을 최신순으로 짝짓는다. 처음 돌리면 기준점만 적고 아무것도 받지 않는다.
#
# 보관함의 다운로드 버튼은 파일 이름에 **저장한 시각**을 붙인다(KakaoTalk_Photo_2026-10-08-11-04-13-1.png,
# 2026-10-08 실측). 그대로 두면 media.ts 의 시각 짝짓기가 틀리므로, 짝지은 메시지의 보낸 시각으로
# 휴대폰 zip 꼴(20261008_103758_1.png) 이름을 다시 붙인다. 번호(-1, -2 …)는 보관함 순서가 아니라
# 체크한 순서를 따른다(같은 날 실측) — 그래서 위에서부터 차례로 체크한다.
#
# 체크박스 · 폴더 탭 · 방 열기는 접근성 동작이 듣지 않아 실제 마우스를 쓴다(방을 선택하고 Return 은 열리지 않는 방이
# 있었다, 2026-11-03 실측). 그 사이 사람이 마우스를 움직이면 멈춘다.
# 실행 주체(터미널 또는 python)에 「손쉬운 사용」 권한과 ~/Downloads 접근 권한이 있어야 한다.
import argparse, csv, hashlib, json, os, re, shutil, signal, subprocess, sys, tempfile, time, unicodedata
from datetime import datetime
from pathlib import Path

import AppKit, Quartz
from ApplicationServices import (
    AXIsProcessTrusted, AXUIElementCopyAttributeValue, AXUIElementCreateApplication, AXUIElementPerformAction,
    AXUIElementSetAttributeValue, AXValueGetValue, kAXValueCGPointType, kAXValueCGSizeType,
)

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kakao_folder import (
    FolderError, can_skip, check_folder, csv_name_for, csv_room, duplicates, env_fingerprint, parse_report, remember_import, room_key, summary, switch_to_folder,
)

BUNDLE = "com.kakao.KakaoTalkMac"
REPO = Path(__file__).resolve().parents[1]
DATA_ROOT = Path(os.environ.get("KAKAO_DATA_DIR", Path.home() / "work/omnis-import"))
DATA = DATA_ROOT / "sync"
DOWNLOADS = Path.home() / "Downloads"
VIDEO_EXT = {".mp4", ".mov", ".m4v"}
nfc = lambda s: unicodedata.normalize("NFC", s)


class Abort(Exception):
    pass


class limit:
    """단계 제한시간 — 넘으면 Abort 로 그 방을 건너뛴다. 큰 방 내보내기도 2분이면 끝난다(9,498건 35초 실측)."""
    def __init__(self, what, seconds):
        self.what, self.seconds = what, int(seconds)

    def __enter__(self):
        def fire(*_):
            raise Abort(f"{self.what} {self.seconds}초 초과")
        self.prev = signal.signal(signal.SIGALRM, fire)
        signal.alarm(self.seconds)

    def __exit__(self, *_):
        signal.alarm(0)
        signal.signal(signal.SIGALRM, self.prev)


def read_config():
    """저장소가 공개라 방 이름은 KAKAO_DATA_DIR/import-config.json 에 둔다."""
    path = DATA_ROOT / "import-config.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def configured_rooms():
    """syncFolder 가 없을 때 받을 방."""
    return [name for name, room in read_config().get("rooms", {}).items() if room.get("sync")]


def log(*a):
    print(datetime.now().strftime("%H:%M:%S"), *a, flush=True)


# ── 접근성 ──────────────────────────────────────────────

def attr(el, name):
    if el is None:
        return None
    err, v = AXUIElementCopyAttributeValue(el, name, None)
    return v if err == 0 else None


def kids(el):
    return list(attr(el, "AXChildren") or [])


def geo(el):
    p, s = attr(el, "AXPosition"), attr(el, "AXSize")
    _, pt = AXValueGetValue(p, kAXValueCGPointType, None)
    _, sz = AXValueGetValue(s, kAXValueCGSizeType, None)
    return pt.x, pt.y, sz.width, sz.height


def press(el):
    # -25204: 저장 창처럼 막 뜬 창은 잠시 동작을 받지 못한다(카톡 26.9.0, 2026-11-04 실측)
    for _ in range(15):
        err = AXUIElementPerformAction(el, "AXPress")
        if err != -25204:
            break
        time.sleep(0.4)
    if err != 0:
        raise Abort(f"누르기 실패 ({err})")


def child(el, **want):
    for k in kids(el):
        if all(attr(k, f"AX{a}") == v for a, v in want.items()):
            return k
    return None


def wait_for(fn, what, timeout=15.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        v = fn()
        if v:
            return v
        time.sleep(0.3)
    raise Abort(f"기다려도 안 나옴: {what}")


def kakao():
    apps = AppKit.NSRunningApplication.runningApplicationsWithBundleIdentifier_(BUNDLE)
    if not apps:
        raise Abort("카카오톡이 켜져 있지 않다")
    return apps[0]


def ax_app():
    return AXUIElementCreateApplication(kakao().processIdentifier())


def windows():
    return list(attr(ax_app(), "AXWindows") or [])


def window(pred):
    return next((w for w in windows() if pred(w)), None)


def activate():
    kakao().activateWithOptions_(AppKit.NSApplicationActivateIgnoringOtherApps)
    time.sleep(0.3)


def menu(*path):
    el = attr(ax_app(), "AXMenuBar")
    for name in path:
        items = kids(el)
        if items and attr(items[0], "AXRole") == "AXMenu":
            items = kids(items[0])
        el = next((k for k in items if attr(k, "AXTitle") == name), None)
        if el is None:
            raise Abort(f"메뉴 없음: {' > '.join(path)}")
    press(el)


# ── 마우스 (체크박스 전용) ───────────────────────────────

class Mouse:
    def __init__(self):
        self.expect = None

    def pos(self):
        p = Quartz.CGEventGetLocation(Quartz.CGEventCreate(None))
        return p.x, p.y

    def _guard(self):
        if self.expect is None:
            return
        x, y = self.pos()
        if abs(x - self.expect[0]) > 2 or abs(y - self.expect[1]) > 2:
            raise Abort("사용 중인 마우스가 움직여 멈춤")

    def _post(self, kind, x, y):
        Quartz.CGEventPost(Quartz.kCGHIDEventTap,
                           Quartz.CGEventCreateMouseEvent(None, kind, (x, y), Quartz.kCGMouseButtonLeft))

    def move(self, x, y):
        self._guard()
        self._post(Quartz.kCGEventMouseMoved, x, y)
        self.expect = (x, y)

    def click(self, x, y, hover=0.5):
        self.move(x, y)
        time.sleep(hover)
        self._guard()
        self._post(Quartz.kCGEventLeftMouseDown, x, y)
        time.sleep(0.05)
        self._post(Quartz.kCGEventLeftMouseUp, x, y)

    def double_click(self, x, y, hover=0.3):
        self.move(x, y)
        time.sleep(hover)
        self._guard()
        for n in (1, 2):
            for kind in (Quartz.kCGEventLeftMouseDown, Quartz.kCGEventLeftMouseUp):
                e = Quartz.CGEventCreateMouseEvent(None, kind, (x, y), Quartz.kCGMouseButtonLeft)
                Quartz.CGEventSetIntegerValueField(e, Quartz.kCGMouseEventClickState, n)
                Quartz.CGEventPost(Quartz.kCGHIDEventTap, e)
                time.sleep(0.04)
            time.sleep(0.08)


# ── 채팅방 · CSV ────────────────────────────────────────

TITLES = {}  # 목록 이름 → 창 제목. 이름 없는 단체방은 둘이 다르다


def room_window(room):
    title = TITLES.get(room, room)
    return window(lambda w: nfc(attr(w, "AXTitle") or "") == title)


def main_window():
    return window(lambda w: attr(w, "AXIdentifier") == "Main Window")


def chat_table():
    main = main_window()
    return next((k for k in kids(main) if attr(k, "AXIdentifier") == "_NS:101"), None) or next(k for k in kids(main) if attr(k, "AXRole") == "AXScrollArea")


def row_names():
    """[(목록 이름, 행)] — 행마다 접근성을 읽어 느리다(750행 38초 실측). 폴더 탭에서만 부른다."""
    out = []
    for r in kids(kids(chat_table())[0]):
        cell = (kids(r) or [None])[0]
        for t in kids(cell):
            if attr(t, "AXIdentifier") == "_NS:40":
                out.append((nfc(attr(t, "AXValue") or ""), r))
    return out


def scroll_chat(value):
    bar = next((k for k in kids(chat_table()) if attr(k, "AXRole") == "AXScrollBar"), None)
    if bar is not None:
        AXUIElementSetAttributeValue(bar, "AXValue", value)
        time.sleep(0.4)


def folder_rooms(folder, mouse, max_rooms):
    """폴더 탭을 눌러 그 폴더의 방 이름을 돌려준다. 탭을 못 찾거나 전환이 안 되면 전체 목록을 잘못 읽지 않게 멈춘다."""
    main = main_window()

    def tab(prefix):
        """탭 줄은 옆으로 밀려 있을 수 있다 — 밖에 있는 탭은 목록에 없거나 좌표가 영역 밖이다(누르면 엉뚱한 곳이 눌린다)."""
        area = next((k for k in kids(main) if attr(k, "AXIdentifier") == "_NS:28"), None)
        if area is None:
            raise FolderError("폴더 탭 줄이 없다")
        ax, _, aw, _ = geo(area)
        bar = next((k for k in kids(area) if attr(k, "AXRole") == "AXScrollBar"), None)
        for value in (None, 0.0, 0.5, 1.0):
            if value is not None and bar is not None:
                AXUIElementSetAttributeValue(bar, "AXValue", value)
                time.sleep(0.4)
            groups = kids((kids(kids(area)[0]) or [None])[0])
            found = next((g for g in groups if any((attr(t, "AXValue") or "").startswith(prefix) for t in kids(g))), None)
            if found is not None and ax <= geo(found)[0] and geo(found)[0] + geo(found)[2] <= ax + aw:
                return found
        raise FolderError(f"「{prefix}」 탭을 찾지 못했다")

    def click(prefix):
        x, y, w, h = geo(tab(prefix))
        mouse.click(x + w / 2, y + h / 2, hover=0.3)

    activate()
    AXUIElementPerformAction(main, "AXRaise")
    wait_for(lambda: attr(ax_app(), "AXFrontmost"), "카톡이 앞으로 나오기", timeout=5)
    # 친구 탭이 떠 있으면 폴더 탭 줄 자체가 없다
    has_tabs = lambda: child(main, Identifier="_NS:28") is not None
    if not has_tabs():
        x, y, w, h = geo(child(main, Identifier="chatrooms"))
        mouse.click(x + w / 2, y + h / 2, hover=0.3)
        wait_for(has_tabs, "채팅 목록 화면", timeout=5)
    tab(f"{folder} folder")
    switch_to_folder(lambda: click("All folder"), lambda: click(f"{folder} folder"),
                     lambda: len(kids(kids(chat_table())[0])), max_rooms)
    scroll_chat(0.0)
    return [n for n, _ in row_names()]


def open_room(room, mouse):
    """방 창을 연다. 이미 열려 있었으면 False (닫지 않고 둔다). 행을 화면에 보이게 굴린 뒤 더블클릭한다."""
    if room_window(room):
        opened = False
    else:
        main = main_window()
        rows = [r for n, r in row_names() if n == room]
        if len(rows) != 1:
            raise Abort(f"채팅 목록에서 방을 {len(rows)}개 찾음: {room}")
        area = chat_table()
        ax, ay, aw, ah = geo(area)
        inside = lambda: ay <= geo(rows[0])[1] and geo(rows[0])[1] + geo(rows[0])[3] <= ay + ah
        for value in (None, 0.0, 0.25, 0.5, 0.75, 1.0):
            if value is not None:
                scroll_chat(value)
            if inside():
                break
        if not inside():
            raise Abort(f"행을 화면에 보이게 하지 못함: {room}")
        before = {nfc(attr(w, "AXTitle") or "") for w in windows()}
        activate()
        AXUIElementPerformAction(main, "AXRaise")
        time.sleep(0.3)
        x, y, w, h = geo(rows[0])
        mouse.double_click(x + w / 2, y + h / 2)
        new = wait_for(lambda: next((z for z in windows() if child(z, Role="AXButton", Title="Send") is not None and nfc(attr(z, "AXTitle") or "") not in before), None), f"{room} 창")
        TITLES[room] = nfc(attr(new, "AXTitle") or "")
        opened = True
    focus_room(room)
    return opened


def focus_room(room):
    w = room_window(room)
    activate()
    AXUIElementPerformAction(w, "AXRaise")
    AXUIElementSetAttributeValue(w, "AXMain", True)
    wait_for(lambda: any(attr(m, "AXTitle") == "Chats" for m in kids(attr(ax_app(), "AXMenuBar"))), "Chats 메뉴")


def close(w):
    b = child(w, Subrole="AXCloseButton")
    if b is not None:
        press(b)


def close_quietly(w):
    """정리 중의 실패가 진짜 원인을 가리지 않게 한다."""
    try:
        close(w)
    except Exception as e:
        log(f"  창 닫기 실패: {e!r}")


def sheet_of(w, pred=lambda s: True):
    return next((k for k in kids(w) if attr(k, "AXRole") == "AXSheet" and pred(k)), None)


def find(el, **want):
    if all(attr(el, f"AX{a}") == v for a, v in want.items()):
        return el
    if attr(el, "AXRole") in ("AXOutline", "AXTable"):
        return None
    for k in kids(el):
        r = find(k, **want)
        if r is not None:
            return r
    return None


def export_csv(room, dest: Path, key=None) -> Path:
    focus_room(room)
    menu("Chats", "Chatroom Settings")
    dlg = wait_for(lambda: window(lambda w: child(w, Value="Chatroom Settings") is not None), "채팅방 설정 창")
    try:
        press(wait_for(lambda: child(dlg, Identifier="_NS:50"), "설정의 두 번째 탭"))
        area = wait_for(lambda: child(dlg, Role="AXScrollArea"), "설정 내용")
        press(wait_for(lambda: child(area, Title="Save as a text file"), "「Save as a text file」 버튼"))
        panel = wait_for(lambda: sheet_of(dlg, lambda s: attr(s, "AXIdentifier") == "save-panel"), "저장 창")
        name = nfc(attr(find(panel, Identifier="saveAsNameTextField"), "AXValue"))
        where = attr(find(panel, Identifier="where popup"), "AXValue")
        if where != "Downloads":
            raise Abort(f"CSV 저장 위치가 Downloads 가 아님: {where}")
        press(find(panel, Identifier="OKButton"))

        def done():
            s = sheet_of(dlg, lambda s: attr(s, "AXIdentifier") != "save-panel")
            texts = [attr(k, "AXValue") or "" for k in kids(s)] if s else []
            return (s, texts) if any("exported" in t or "fail" in t.lower() for t in texts) else None
        s, texts = wait_for(done, "내보내기 끝", timeout=600)
        press(child(s, Role="AXButton"))
        if not any("Successfully" in t for t in texts):
            raise Abort(f"CSV 내보내기 실패: {texts}")
    finally:
        close(dlg)
    src = next((p for p in DOWNLOADS.iterdir() if nfc(p.name) == name + ".csv"), None)
    if src is None:
        raise Abort(f"내보낸 CSV 를 못 찾음: {name}.csv")
    dest.mkdir(parents=True, exist_ok=True)
    for old in dest.glob("*.csv"):
        old.unlink()
    out = dest / csv_name_for(key or room, nfc(src.name))
    shutil.move(src, out)
    return out


def placeholders(path: Path):
    """사진·영상 자리표시를 줄 단위로 읽는다. [(보낸 시각, 영상인가, 장수)] — 파일 순서(오래된 것 먼저).
    「7 photos」 같은 묶음은 보관함에서도 한 칸(multiimage)이고, 받으면 장수만큼 파일이 떨어진다(2026-10-16 실측)."""
    out = []
    with open(path, encoding="utf-8-sig", newline="") as f:
        for row in csv.reader(f):
            if len(row) < 3 or not re.match(r"\d{4}-\d{2}-\d{2} ", row[0]):
                continue
            m = row[2].strip()
            if m == "Photo":
                out.append((row[0], False, 1))
            elif m == "Video":
                out.append((row[0], True, 1))
            elif re.fullmatch(r"\d+ photos", m):
                out.append((row[0], False, int(m.split()[0])))
    return out


def after_seen(units, seen):
    """state 의 seen(장 수)을 넘어선 줄들. seen 이 묶음 한가운데면 None."""
    total = 0
    for i, u in enumerate(units):
        if total == seen:
            return units[i:]
        total += u[2]
        if total > seen:
            return None
    return [] if total == seen else None


# ── 사진 보관함 ─────────────────────────────────────────

def archive_window():
    return window(lambda w: child(w, Value="Chatroom Archives") is not None)


def open_archive(room):
    focus_room(room)
    menu("Chats", "Chatroom Archives", "Photos/Videos")
    w = wait_for(archive_window, "사진 보관함")
    wait_for(lambda: nfc(attr(child(w, Identifier="_NS:55"), "AXValue") or "") == room, f"보관함의 방이 {room}")
    wait_for(lambda: attr(child(w, Identifier="_NS:106"), "AXValue"), "보관함 개수")
    return w


def archive_count(w):
    return int(attr(child(w, Identifier="_NS:106"), "AXValue").replace(",", ""))


def selected(w):
    t = attr(child(w, Identifier="_NS:38"), "AXValue")
    return int(t.split()[0]) if t else 0


def visible_items(w):
    area = child(w, Identifier="_NS:88")
    ax, ay, aw, ah = geo(area)
    items = []
    for sec in kids(kids(area)[0]):
        if attr(sec, "AXSubrole") != "AXSectionList":
            continue
        items += [g for g in kids(sec) if attr(g, "AXRole") == "AXGroup"]
    return [g for g in items if geo(g)[1] >= ay and geo(g)[1] + geo(g)[3] <= ay + ah]


def is_multi(g):
    return any(attr(c, "AXDescription") == "chat image multiimage" for c in kids(g))


def download_top(w, skip, units, mouse: Mouse):
    """맨 위에서 skip 칸을 건너뛰고 units(최신순 [(시각, 영상인가, 장수)]) 만큼 위에서부터 차례로 체크해 받는다.
    칸마다 받은 파일 목록을 체크 순서대로 돌려준다."""
    n = len(units)
    if selected(w):
        raise Abort("보관함에 이미 체크된 항목이 있다")
    # 지난 다운로드의 완료 창이 남아 있으면 이번 결과로 잘못 읽는다
    while (stale := window(lambda x: attr(x, "AXTitle") == "Save")) is not None:
        close(stale)
        time.sleep(0.3)
    # 개수 글자가 먼저 뜨고 썸네일 칸은 조금 늦게 그려진다
    items = wait_for(lambda: visible_items(w), "보관함 썸네일")
    if skip + n > len(items):
        raise Abort(f"새 사진 {n}칸이 보관함 첫 화면({len(items)}칸)을 넘는다 — 손으로 받아야 한다")
    for g, (t, _, k) in zip(items[skip:skip + n], units):
        if is_multi(g) != (k > 1):
            raise Abort(f"짝이 어긋남: {t} 는 {k}장인데 보관함 칸은 {'묶음' if is_multi(g) else '한 장'}")
    before = {p.name for p in DOWNLOADS.iterdir()}
    for i, g in enumerate(items[skip:skip + n], 1):
        activate()
        x, y, _, _ = geo(g)
        mouse.move(x + 60, y + 60)
        time.sleep(0.4)
        mouse.click(x + 14, y + 14)
        wait_for(lambda: selected(w) == i, f"{i}장 체크")
    press(child(w, Identifier="_NS:68"))

    def saved():
        s = window(lambda x: attr(x, "AXTitle") == "Save")
        texts = [attr(k, "AXValue") or "" for k in kids(s)] if s else []
        line = next((t for t in texts if t.startswith("Saved:")), None)
        return (s, line) if line else None
    s, line = wait_for(saved, "다운로드 끝", timeout=600)
    close(s)
    total = sum(k for _, _, k in units)
    ok, failed = map(int, re.findall(r"\d+", line)[:2])
    if ok != total or failed:
        raise Abort(f"다운로드 결과가 다름: {line} (기대 {total}장)")
    pat = re.compile(r"^KakaoTalk_\w+_\d{4}(?:-\d{2}){5}-(\d+)\.\w+$")
    new = {}
    for p in DOWNLOADS.iterdir():
        m = pat.match(p.name)
        if p.name not in before and m:
            new[int(m.group(1))] = p
    if sorted(new) != list(range(1, total + 1)):
        raise Abort(f"받은 파일 번호가 1..{total} 이 아님: {sorted(new)}")
    # 묶음은 이어진 번호로 떨어진다
    out, at = [], 1
    for _, _, k in units:
        out.append([new[j] for j in range(at, at + k)])
        at += k
    return out


# ── 한 방 ───────────────────────────────────────────────

def sync_room(room, key, state, mouse, args):
    """room: 채팅 목록 이름 · key: 설정 · 상태 · 폴더의 방 키. 둘은 이름 없는 단체방에서만 다르다."""
    st = state.get(key)
    room_dir = DATA / key
    step = args.step_timeout
    with limit("방 열기", step):
        opened = open_room(room, mouse)
    try:
        with limit("CSV 내보내기", step * 2):
            csv_path = export_csv(room, room_dir / "csv", key)
        ph = placeholders(csv_path)
        with limit("보관함 열기", step):
            w = open_archive(room)
        try:
            count = archive_count(w)
            seen = sum(u[2] for u in ph)  # state 의 seen 은 장 수
            log(f"{key}: 보관함 {count}칸 · CSV 사진 자리표시 {len(ph)}줄 {seen}장")
            if st is None or args.rebase:
                state[key] = {**(st or {}), "count": count, "seen": seen}
                log(f"{key}: 기준점만 적었다 — 다음 실행부터 새 사진을 받는다")
                return csv_path, 0
            new_ph = after_seen(ph, st["seen"])
            k = len(new_ph) if new_ph is not None else -1
            d = count - st["count"]
            if d < k or k < 0:
                state[key] = {**(st or {}), "count": count, "seen": seen}
                log(f"⚠ {key}: 보관함 +{d}칸 · 자리표시 +{k}줄 — 짝이 안 맞아 이번 것은 건너뛰고 기준점을 다시 잡는다")
                for t, v, n in new_ph or []:
                    log(f"    손으로 확인할 것: {t} {'영상' if v else f'사진 {n}장'}")
                return csv_path, 0
            if k == 0:
                state[key] = {**(st or {}), "count": st["count"], "seen": seen}
                return csv_path, 0
            extra = d - k  # CSV 를 내보낸 뒤 올라온 것 — 맨 위에 있다. 다음 실행에서 받는다.
            units = new_ph[::-1]  # 보관함 i 번째(최신순) ↔ 새 자리표시의 뒤에서 i 번째
            with limit("사진 받기", max(step, 600)):
                files = download_top(w, extra, units, mouse)
        finally:
            close_quietly(w)
        media = room_dir / "media"
        media.mkdir(parents=True, exist_ok=True)
        for (t, is_video, _), fs in zip(units, files):
            for f in fs:
                if (f.suffix.lower() in VIDEO_EXT) != is_video:
                    raise Abort(f"짝이 어긋남: {t} 는 {'영상' if is_video else '사진'}인데 받은 파일은 {f.name}")
        stamp_n = {}
        for (t, _, _), fs in zip(units, files):
            base = datetime.strptime(t, "%Y-%m-%d %H:%M:%S").strftime("%Y%m%d_%H%M%S")
            for f in fs:
                stamp_n[base] = stamp_n.get(base, 0) + 1
                shutil.move(f, media / f"{base}_{stamp_n[base]}{f.suffix.lower()}")
        got = sum(len(fs) for fs in files)
        # 건식 · --no-import 로 받기만 하면 다음 실행의 CSV 가 같아도 넣어야 한다
        state[key] = {**(st or {}), "count": count - extra, "seen": seen, "mediaPending": True}
        log(f"{key}: 새 사진·영상 {got}장({k}칸) 받음" + (f" (내보낸 뒤 올라온 {extra}칸은 다음에)" if extra else ""))
        return csv_path, got
    finally:
        if opened and room_window(room):
            close_quietly(room_window(room))


def run_import(key, csv_path, args, data_dir=None):
    """kakao.ts 를 돌려 보고 줄을 돌려준다. 출력은 그대로 흘려보낸다."""
    media = DATA / key / "media"
    cmd = ["npx", "tsx", "import-tools/kakao.ts", str(csv_path), "--auto-rooms"]
    if media.exists() and any(media.iterdir()):
        cmd += ["--media", str(media), "--media-room", key]
    if args.target == "prod":
        cmd += ["--target", "prod"]
    if data_dir:
        cmd += ["--dry"]
    log("이식:", " ".join(cmd[3:]))
    env = {**os.environ, "KAKAO_DATA_DIR": str(data_dir)} if data_dir else None
    p = subprocess.Popen(cmd, cwd=REPO, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    lines = []
    for line in p.stdout:
        print(line, end="", flush=True)
        lines.append(line.rstrip("\n"))
    if p.wait() != 0:
        raise Abort(f"kakao.ts 실패 ({p.returncode})")
    return parse_report(lines) or {}


def dry_copy():
    """kakao.ts --dry 도 마스터와 세션 파일을 쓴다 — 방마다 임시 사본에서 돌려 진짜 마스터와 다른 방 건수를 건드리지 않는다."""
    tmp = Path(tempfile.mkdtemp(prefix="kakao-dry-"))
    (tmp / "raw").mkdir()
    for name in ("raw/messages.json", "final.json", "sessions.json", "classified.json", "import-config.json"):
        if (DATA_ROOT / name).exists():
            shutil.copy2(DATA_ROOT / name, tmp / name)
    if (DATA_ROOT / "structure").exists():
        shutil.copytree(DATA_ROOT / "structure", tmp / "structure")
    if (DATA_ROOT / "exclude.json").exists():
        (tmp / "exclude.json").symlink_to(DATA_ROOT / "exclude.json")
    return tmp


def import_rooms(todo, state, state_path, args, dry):
    """todo: [(방 키, CSV, 받은 사진 수)]. 한 방이 실패해도 나머지를 넣는다."""
    results, failed = [], {}
    rooms = read_config().get("rooms", {})
    exclude = DATA_ROOT / "exclude.json"
    exclude_bytes = lambda: exclude.read_bytes() if exclude.exists() else b""
    for key, csv_path, got in todo:
        digest = hashlib.sha256(csv_path.read_bytes()).hexdigest()
        if can_skip(state.get(key), digest, env_fingerprint(rooms.get(key), exclude_bytes()), got):
            log(f"{key}: 새 글 · 새 사진 없음 — 이식 건너뜀")
            results.append({"room": key, "skipped": True})
            continue
        tmp = dry_copy() if dry else None
        t0 = time.time()
        try:
            report = run_import(key, csv_path, args, tmp)
            elapsed = round(time.time() - t0)
            log(f"{key}: 이식 {elapsed}초")
            results.append({"room": key, "elapsed": elapsed, **report})
            if not dry:
                # 방 설정은 kakao.ts 가 바꿀 수 있으므로 끝난 뒤의 것을 적는다
                env = env_fingerprint(read_config().get("rooms", {}).get(key), exclude_bytes())
                state[key], left = remember_import(state.get(key), digest, env, report)
                if left:
                    log(f"⚠ {key}: 남은 일 {left} — CSV 가 그대로여도 다음 실행에서 다시 돌린다")
                state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2))
        except Exception as e:
            failed[key] = str(e)[:200]
            log(f"✗ {key}: {e}")
        finally:
            if tmp:
                shutil.rmtree(tmp, ignore_errors=True)
    return results, failed


def from_csv(args):
    """카톡을 건드리지 않고 폴더의 CSV 로 건식만 — 코드 · 설정 점검용. 방마다 가장 최근 파일만 쓴다."""
    latest = {}
    for path in sorted(Path(args.from_csv).expanduser().rglob("KakaoTalk_Chat_*.csv"), key=lambda p: csv_room(p.name)[1] or ""):
        room = csv_room(path.name)[0]
        if room:
            latest[room] = path
    results, failed = import_rooms([(k, p, 0) for k, p in latest.items()], {}, None, args, True)
    print(summary(results, failed, [], True))
    sys.exit(1 if failed else 0)


def idle_seconds():
    out = subprocess.check_output(["ioreg", "-c", "IOHIDSystem", "-d", "4"]).decode()
    return int(re.search(r'"HIDIdleTime" = (\d+)', out).group(1)) / 1e9


def screen_locked():
    d = Quartz.CGSessionCopyCurrentDictionary() or {}
    return bool(d.get("CGSSessionScreenIsLocked"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", choices=["local", "prod"], default="local")
    ap.add_argument("--when-idle", type=float, default=0, metavar="분")
    ap.add_argument("--no-import", action="store_true")
    ap.add_argument("--dry", action="store_true", help="이식은 임시 폴더에서 건식으로만. 카톡에서 받는 것은 그대로 한다")
    ap.add_argument("--from-csv", metavar="DIR", help="카톡을 건드리지 않고 이 폴더의 CSV 로 건식만")
    ap.add_argument("--rebase", action="store_true", help="받지 않고 기준점만 지금으로 다시 잡는다")
    ap.add_argument("--room", action="append", help="폴더 대신 이 방만 (여러 번 줄 수 있다)")
    ap.add_argument("--folder", help="카톡 채팅 폴더. 기본은 import-config.json 의 syncFolder")
    ap.add_argument("--step-timeout", type=float, default=90, metavar="초", help="단계 제한시간 (기본 90초)")
    ap.add_argument("--max-rooms", type=int, default=50, help="폴더에 이보다 많으면 폴더가 아닌 것으로 보고 멈춘다")
    ap.add_argument("--max-new-rooms", type=int, default=10, help="새 방이 이보다 많으면 멈춘다")
    args = ap.parse_args()

    if args.from_csv:
        return from_csv(args)
    if args.when_idle:
        if screen_locked():
            return log("화면이 잠겨 있어 건너뜀")
        if idle_seconds() < args.when_idle * 60:
            return log(f"사용 중이라 건너뜀 (입력 없는 시간 {idle_seconds() / 60:.1f}분)")
    if not AXIsProcessTrusted():
        sys.exit("손쉬운 사용 권한이 없다 — 시스템 설정 > 개인정보 보호 및 보안 > 손쉬운 사용 에서 이 실행 주체를 켜세요")

    config = read_config()
    folder = args.folder or config.get("syncFolder")
    DATA.mkdir(parents=True, exist_ok=True)
    state_path = DATA / "state.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    front = AppKit.NSWorkspace.sharedWorkspace().frontmostApplication()
    mouse = Mouse()
    start_pos = mouse.pos()
    todo, failed, not_started = [], {}, []
    stopped = False
    fails_in_row = 0
    try:
        if args.room:
            rooms = [nfc(r) for r in args.room]
        elif folder:
            if not config.get("me"):
                sys.exit("import-config.json 에 me(내 계정 이름)가 없다 — 새 방의 참여자를 정할 수 없다")
            try:
                with limit("폴더 목록 읽기", args.step_timeout):
                    rooms = check_folder(folder_rooms(folder, mouse, args.max_rooms), config.get("rooms", {}), folder, args.max_rooms, args.max_new_rooms)
            except (FolderError, Abort) as e:
                sys.exit(f"멈춤 — {e}. 아무 방도 건드리지 않았다")
            log(f"「{folder}」 폴더 {len(rooms)}개 방")
        else:
            rooms = configured_rooms()
        if not rooms:
            sys.exit("받을 방이 없다 — syncFolder 또는 sync: true 를 두거나 --room 을 주세요")
        dup = duplicates(rooms)
        for i, room in enumerate(rooms):
            if room in dup:
                failed[room] = "이름이 같은 방이 둘 이상이라 가를 수 없다"
                log(f"✗ {room}: {failed[room]}")
                continue
            key = room_key(room, config.get("rooms", {}))
            try:
                t0 = time.time()
                csv_path, got = sync_room(room, key, state, mouse, args)
                log(f"{key}: 카톡 {round(time.time() - t0)}초")
                todo.append((key, csv_path, got))
                fails_in_row = 0
            except Exception as e:
                failed[key] = str(e)[:200]
                log(f"✗ {key}: {e!r}" if not isinstance(e, Abort) else f"✗ {key}: {e}")
                fails_in_row += 1
                # 연달아 실패하면 화면을 잘못 읽는 것이다 — 방 창을 더 열지 않는다
                if "마우스" in str(e) or fails_in_row >= 2:
                    not_started = [r for r in rooms[i + 1:]]
                    stopped = "마우스" in str(e)
                    break
            finally:
                state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2))
    finally:
        if front is not None:
            front.activateWithOptions_(0)
        if mouse.expect is not None and not failed:
            Quartz.CGWarpMouseCursorPosition(start_pos)

    results = []
    if not args.no_import:
        results, import_failed = import_rooms(todo, state, state_path, args, args.dry)
        failed.update(import_failed)
    print(summary(results, failed, not_started, args.dry), flush=True)
    if stopped:
        log("사람이 마우스를 움직여 멈췄다. 받은 방까지만 이식했다")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
