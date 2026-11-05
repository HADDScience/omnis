# python3 -m unittest import-tools/test_kakao_folder.py — 카톡 없이 돈다. 이름은 지어낸 값이다.
import csv, os, sys, tempfile, unittest
from datetime import date
sys.path.insert(0, os.path.dirname(__file__))
from kakao_folder import FolderError, dedupe_scrolled, excluded_file_times, file_baseline, file_lines, file_report, file_stamp_dir, file_summary, parse_expiry, parse_size, plan_files, saved_name_ok, size_matches, can_skip, check_folder, csv_name_for, csv_room, duplicates, env_fingerprint, leftovers, parse_report, remember_import, room_key, safe_key, summary, switch_to_folder

ROOMS = {"전사방": {"kind": "COMPANY"}, "Group Chat": {"kind": "GROUP", "listName": "갑, 을, 병"}}


class SwitchToFolder(unittest.TestCase):
    """rows 는 지금 탭의 행 수. absorb 만큼의 클릭은 창을 앞으로 가져오는 데만 쓰여 듣지 않는다."""
    def run_switch(self, start, absorb=0, stuck=False, tries=3):
        state = {"rows": start, "absorb": absorb, "clicks": 0}

        def click(rows):
            def go():
                state["clicks"] += 1
                if state["absorb"] > 0:
                    state["absorb"] -= 1
                elif not stuck:
                    state["rows"] = rows
            return go
        switch_to_folder(click(750), click(11), lambda: state["rows"], 50, tries=tries, sleep=lambda _: None)
        return state

    def test_전체_탭을_거쳐_폴더로_간다(self):
        self.assertEqual(self.run_switch(750), {"rows": 11, "absorb": 0, "clicks": 2})

    def test_다른_폴더에_있어도_전체를_거친다(self):
        self.assertEqual(self.run_switch(3)["rows"], 11)

    def test_첫_클릭이_먹혀도_다시_눌러_바뀐다(self):
        self.assertEqual(self.run_switch(750, absorb=1)["rows"], 11)

    def test_탭이_끝내_안_바뀌면_멈춘다(self):
        with self.assertRaises(FolderError):
            self.run_switch(750, stuck=True)

    def test_전체_탭으로_못_가면_폴더를_읽지_않는다(self):
        with self.assertRaises(FolderError):
            self.run_switch(3, stuck=True)


CLEAN = {"leftover": {"classify": 0, "structure": 0, "photos": 0, "photoIndex": 0}}


class SkipImport(unittest.TestCase):
    DONE = {"importedCsv": "c1", "importedEnv": "e1"}

    def test_같은_CSV_이고_남은_일이_없으면_건너뛴다(self):
        self.assertTrue(can_skip(self.DONE, "c1", "e1", 0))

    def test_새_글이_있으면_돌린다(self):
        self.assertFalse(can_skip(self.DONE, "c2", "e1", 0))

    def test_이번에_사진을_받았으면_돌린다(self):
        self.assertFalse(can_skip(self.DONE, "c1", "e1", 3))

    def test_건식으로_받아_둔_사진이_있으면_돌린다(self):
        self.assertFalse(can_skip({**self.DONE, "mediaPending": True}, "c1", "e1", 0))

    def test_방_설정이나_제외_목록이_바뀌면_돌린다(self):
        self.assertFalse(can_skip(self.DONE, "c1", "e2", 0))

    def test_기능_전의_완료_기록은_같은_것으로_본다(self):
        self.assertTrue(can_skip({"importedCsv": "c1"}, "c1", "e1", 0))

    def test_기록이_없는_방은_돌린다(self):
        self.assertFalse(can_skip(None, "c1", "e1", 0))

    def test_제외_목록이_바뀌면_지문이_달라진다(self):
        self.assertNotEqual(env_fingerprint({"kind": "DM"}, b"a"), env_fingerprint({"kind": "DM"}, b"b"))

    def test_방_설정_칸_순서는_지문에_영향이_없다(self):
        self.assertEqual(env_fingerprint({"a": 1, "b": 2}, b""), env_fingerprint({"b": 2, "a": 1}, b""))


class RememberImport(unittest.TestCase):
    def test_깨끗하면_완료를_적고_받아_둔_사진_표시를_지운다(self):
        st, left = remember_import({"count": 1, "mediaPending": True}, "c1", "e1", CLEAN)
        self.assertEqual((st, left), ({"count": 1, "importedCsv": "c1", "importedEnv": "e1"}, {}))

    def test_분류_실패가_남으면_같은_CSV_도_다음에_돌린다(self):
        prev = {"importedCsv": "c1", "importedEnv": "e1"}
        report = {"leftover": {**CLEAN["leftover"], "classify": 2}}
        st, left = remember_import(prev, "c1", "e1", report)
        self.assertEqual(left, {"classify": 2})
        self.assertFalse(can_skip(st, "c1", "e1", 0))

    def test_카드_라운드_사진_설명_사진_색인_실패도_마찬가지다(self):
        for kind in ("structure", "photos", "photoIndex"):
            st, left = remember_import({}, "c1", "e1", {"leftover": {**CLEAN["leftover"], kind: 1}})
            self.assertEqual(left, {kind: 1})
            self.assertFalse(can_skip(st, "c1", "e1", 0))

    def test_남은_일이_있으면_받아_둔_사진_표시도_유지한다(self):
        st, _ = remember_import({"mediaPending": True}, "c1", "e1", {"leftover": {"photos": 1}})
        self.assertTrue(st["mediaPending"])

    def test_보고가_없으면_끝났다고_보지_않는다(self):
        self.assertEqual(leftovers({}), {"unknown": 1})
        st, _ = remember_import({"importedCsv": "c1"}, "c1", "e1", {})
        self.assertNotIn("importedCsv", st)


class SummaryLeftover(unittest.TestCase):
    def test_남은_일과_시간을_보여_준다(self):
        text = summary([{"room": "갑", "inserted": 1, "elapsed": 9, "leftover": {"classify": 2}}], {}, [], False)
        self.assertIn("· 9초", text)
        self.assertIn("다시 돌릴 방 1: 갑 (classify 2)", text)

    def test_건너뛴_방은_남은_일로_세지_않는다(self):
        self.assertNotIn("다시 돌릴 방", summary([{"room": "갑", "skipped": True}], {}, [], False))


class RoomKey(unittest.TestCase):
    def test_등록된_방은_그대로(self):
        self.assertEqual(room_key("전사방", ROOMS), "전사방")

    def test_이름_없는_단체방은_목록_이름으로_찾는다(self):
        self.assertEqual(room_key("갑, 을, 병", ROOMS), "Group Chat")

    def test_다른_이름_없는_단체방은_섞이지_않는다(self):
        self.assertEqual(room_key("정, 무", ROOMS), "정, 무")

    def test_긴_이름은_잘라도_구분된다(self):
        a, b = safe_key("가" * 200), safe_key("가" * 199 + "나")
        self.assertNotEqual(a, b)
        self.assertLessEqual(len(a.encode()), 160)

    def test_NFD_도_같은_방(self):
        import unicodedata
        self.assertEqual(room_key(unicodedata.normalize("NFD", "전사방"), ROOMS), "전사방")


class CsvName(unittest.TestCase):
    def test_방_키로_이름을_고친다(self):
        self.assertEqual(csv_name_for("정, 무", "KakaoTalk_Chat_Group Chat_2026-11-03-15-00-00.csv"), "KakaoTalk_Chat_정, 무_2026-11-03-15-00-00.csv")
        self.assertEqual(csv_room("KakaoTalk_Chat_a_b_2026-11-03-15-00-00.csv")[0], "a_b")

    def test_같으면_그대로(self):
        n = "KakaoTalk_Chat_전사방_2026-11-03-15-00-00.csv"
        self.assertEqual(csv_name_for("전사방", n), n)

    def test_카톡_이름이_아니면_거부(self):
        with self.assertRaises(ValueError):
            csv_name_for("전사방", "x.csv")


class Folder(unittest.TestCase):
    def check(self, names, rooms=ROOMS, max_rooms=50, max_new=10):
        return check_folder(names, rooms, "폴더", max_rooms, max_new)

    def test_정상(self):
        self.assertEqual(self.check(["전사방", "새 방"]), ["전사방", "새 방"])

    def test_빈_목록은_멈춘다(self):
        with self.assertRaises(FolderError):
            self.check([])

    def test_전체_탭처럼_많으면_멈춘다(self):
        with self.assertRaises(FolderError):
            self.check(["전사방"] + [f"방{i}" for i in range(750)], max_new=1000)

    def test_아는_방이_없으면_멈춘다(self):
        with self.assertRaises(FolderError):
            self.check(["모르는 방"])

    def test_새_방이_상한을_넘으면_멈춘다(self):
        with self.assertRaises(FolderError):
            self.check(["전사방"] + [f"방{i}" for i in range(11)])

    def test_처음_돌릴_때는_아는_방이_없어도_된다(self):
        self.assertEqual(self.check(["새 방"], rooms={}), ["새 방"])

    def test_같은_이름은_가려낸다(self):
        self.assertEqual(duplicates(["갑", "을", "갑"]), {"갑"})


class Report(unittest.TestCase):
    def test_보고_줄을_읽는다(self):
        self.assertEqual(parse_report(["x", '@@kakao-report {"inserted": 3}', "y"]), {"inserted": 3})
        self.assertIsNone(parse_report(["x"]))

    def test_실행_보고에_필요한_것이_다_있다(self):
        s = summary([{"room": "새 방", "inserted": 3, "newRoom": True, "newExternals": ["외부갑"]}], {"실패방": "시간 초과"}, ["남은방"], False)
        for want in ("새 방: 넣은 글 3건", "새 방 1", "새 외부 발화자 1: 외부갑", "실패 방 1: 실패방 (시간 초과)", "시작 못 한 방 1: 남은방"):
            self.assertIn(want, s)


def csv_file(rows):
    f = tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False, encoding="utf-8-sig", newline="")
    w = csv.writer(f)
    w.writerow(["Date", "User", "Message"])
    w.writerows(rows)
    f.close()
    return f.name


def line(t, name, **kw):
    return {"t": t, "name": name, "deleted": False, "multi": False, **kw}


def cell(name, expiry, size="1.0MB"):
    return {"name": name, "expiry": expiry, "size": size}


TODAY = date(2026, 11, 5)


class FileLines(unittest.TestCase):
    def test_파일_줄만_읽고_삭제된_글도_센다(self):
        path = csv_file([
            ["2026-11-01 10:00:00", "갑", "안녕"],
            ["2026-11-01 10:01:00", "갑", "File: 가.pdf"],
            ["2026-11-01 10:02:00", "을", "Photo"],
            ["2026-11-01 10:03:00", "을", "File: 나.hwp\nThe message has been deleted."],
        ])
        got = file_lines(path)
        self.assertEqual([(g["name"], g["deleted"]) for g in got], [("가.pdf", False), ("나.hwp", True)])

    def test_기준점은_지난_CSV_줄_수이고_기록이_우선이다(self):
        lines = [line("2026-11-01 10:00:00", "가.pdf")] * 5
        self.assertEqual(file_baseline(None, lines, 3), 3)
        self.assertEqual(file_baseline(None, lines, None), 5)
        self.assertEqual(file_baseline(None, lines, 9), 5)
        self.assertEqual(file_baseline({"seen": 4, "pending": []}, lines, 3), 4)

    def test_제외_목록의_파일_줄(self):
        ex = [{"room": "방", "t": "2026-11-01 10:01:00", "m": "File: 가.pdf"}, {"room": "다른 방", "t": "2026-11-01 10:01:00", "m": "File: 나.pdf"}, {"room": "방", "t": "2026-11-01 10:02:00", "m": "그냥 글"}]
        self.assertEqual(excluded_file_times(ex, "방"), {("2026-11-01 10:01:00", "가.pdf")})


class FileLabels(unittest.TestCase):
    def test_크기(self):
        self.assertEqual(parse_size("1.0KB"), 1024)
        self.assertIsNone(parse_size("모름"))
        self.assertTrue(size_matches("65.7KB", 67311))
        self.assertFalse(size_matches("65.7KB", 70000))
        self.assertFalse(size_matches("모름", 1))
        self.assertTrue(size_matches("12B", 12))
        self.assertFalse(size_matches("12B", 13))

    def test_만료일(self):
        self.assertEqual(parse_expiry("Expiry: 11/19/2026"), date(2026, 11, 19))
        self.assertIsNone(parse_expiry(""))

    def test_저장된_이름(self):
        self.assertTrue(saved_name_ok("가 나.pptx", "가 나.pptx"))
        self.assertTrue(saved_name_ok("가 나 (1).pptx", "가 나.pptx"))
        self.assertTrue(saved_name_ok("확장자없음 (2)", "확장자없음"))
        self.assertFalse(saved_name_ok("다른 파일.pptx", "가 나.pptx"))
        self.assertFalse(saved_name_ok("가 나.pdf", "가 나.pptx"))
        self.assertTrue(saved_name_ok("가\u1100\u1161.pdf", "가\uac00.pdf"))  # Downloads 는 NFD

    def test_같은_초의_폴더(self):
        self.assertEqual(file_stamp_dir("2026-11-05 10:29:54", set()), "20261105_102954")
        self.assertEqual(file_stamp_dir("2026-11-05 10:29:54", {"20261105_102954"}), "20261105_102954_2")

    def test_겹쳐_읽은_칸을_뺀다(self):
        a, b = cell("가.pdf", date(2026, 11, 19)), cell("나.pdf", date(2026, 11, 18))
        self.assertEqual(dedupe_scrolled([a, b, dict(b)]), [a, b])


class PlanFiles(unittest.TestCase):
    T = "2026-11-05 10:00:00"
    E = date(2026, 11, 19)

    def plan(self, todo, items, lines=None, today=TODAY, excluded=frozenset()):
        return plan_files(todo, lines if lines is not None else todo, items, today, excluded)

    def test_이름과_만료일이_맞으면_받는다(self):
        p = self.plan([line(self.T, "가.pdf")], [cell("가.pdf", self.E)])
        self.assertEqual(len(p["get"]), 1)
        self.assertEqual((p["wait"], p["gone"]), ([], []))

    def test_같은_이름은_시각_순서로_가른다(self):
        new, old = line("2026-11-05 10:00:00", "같은.pdf"), line("2026-11-03 10:00:00", "같은.pdf")
        items = [cell("같은.pdf", date(2026, 11, 19), "2.0MB"), cell("같은.pdf", date(2026, 11, 17), "1.0MB")]
        p = self.plan([new, old], items)
        self.assertEqual([(l["t"], it["size"]) for l, it in p["get"]], [(new["t"], "2.0MB"), (old["t"], "1.0MB")])

    def test_내보낸_뒤_같은_이름이_또_오면_받지_않고_기다린다(self):
        old = line("2026-11-03 10:00:00", "같은.pdf")
        p = self.plan([old], [cell("같은.pdf", date(2026, 11, 19)), cell("같은.pdf", date(2026, 11, 17))])
        self.assertEqual((p["get"], p["wait"]), ([], [old]))

    def test_서랍에_아직_없으면_기다리고_보존기간이_지나면_버린다(self):
        l = line(self.T, "가.pdf")
        self.assertEqual(self.plan([l], [])["wait"], [l])
        self.assertEqual(self.plan([l], [], today=date(2026, 11, 21))["gone"], [(l, "만료")])

    def test_만료된_칸은_받지_않는다(self):
        l = line("2026-10-01 10:00:00", "가.pdf")
        self.assertEqual(self.plan([l], [cell("가.pdf", date(2026, 10, 15))])["gone"], [(l, "만료")])

    def test_이름이_다르면_붙이지_않는다(self):
        l = line(self.T, "가.pdf")
        p = self.plan([l], [cell("다른.pdf", self.E)])
        self.assertEqual((p["get"], p["wait"]), ([], [l]))

    def test_삭제된_글_제외된_글은_받지_않는다(self):
        d = line(self.T, "가.pdf", deleted=True)
        self.assertEqual(self.plan([d], [cell("가.pdf", self.E)])["gone"], [(d, "삭제된 글")])
        e = line(self.T, "나.pdf")
        p = self.plan([e], [cell("나.pdf", self.E)], excluded={(self.T, "나.pdf")})
        self.assertEqual((p["get"], p["gone"]), ([], [(e, "제외 목록")]))

    def test_제외된_글은_같은_이름_순서에서도_빠진다(self):
        kept, ex = line("2026-11-03 10:00:00", "같은.pdf"), line("2026-11-05 10:00:00", "같은.pdf")
        # 서랍에는 둘 다 있다 — 제외 줄을 순서에서 빼면 최신 칸이 kept 와 짝지어져 만료일이 어긋나 받지 않는다
        p = self.plan([kept], [cell("같은.pdf", date(2026, 11, 19)), cell("같은.pdf", date(2026, 11, 17))], lines=[kept, ex], excluded={(ex["t"], "같은.pdf")})
        self.assertEqual(p["get"], [])
        self.assertEqual(p["wait"], [kept])

    def test_상한을_넘으면_받지_않는다(self):
        l = line(self.T, "큰.zip")
        self.assertEqual(self.plan([l], [cell("큰.zip", self.E, "301.0MB")])["gone"], [(l, "300MB 초과")])
        self.assertEqual(len(self.plan([l], [cell("큰.zip", self.E, "299.0MB")])["get"]), 1)

    def test_여러_번_실패하면_목록에서_뺀다(self):
        l = line(self.T, "가.pdf", tries=5)
        self.assertEqual(self.plan([l], [cell("가.pdf", self.E)])["gone"], [(l, "5번 실패")])

    def test_크기를_못_읽으면_기다린다(self):
        l = line(self.T, "가.pdf")
        self.assertEqual(self.plan([l], [cell("가.pdf", self.E, "?")])["wait"], [l])


class FileState(unittest.TestCase):
    def test_받지_못한_파일이_남으면_건너뛰지_않는다(self):
        st, left = remember_import({"files": {"seen": 3, "pending": [line("2026-11-05 10:00:00", "가.pdf")]}}, "csv", "env", {"leftover": {}})
        self.assertEqual(left, {})
        self.assertTrue(st["mediaPending"])
        self.assertFalse(can_skip(st, "csv", "env", 0))

    def test_다_받으면_건너뛴다(self):
        st, _ = remember_import({"mediaPending": True, "files": {"seen": 3, "pending": []}}, "csv", "env", {"leftover": {}})
        self.assertNotIn("mediaPending", st)
        self.assertTrue(can_skip(st, "csv", "env", 0))

    def test_올리기_실패는_다음_실행에서_다시_돈다(self):
        st, left = remember_import({"mediaPending": True}, "csv", "env", {"leftover": {"media": 1}})
        self.assertEqual(left, {"media": 1})
        self.assertTrue(st["mediaPending"])
        self.assertNotIn("importedCsv", st)


class FileSummary(unittest.TestCase):
    def test_건식은_받을_목록을_보여_준다(self):
        r = file_report(wait=1, gone=["만료"], listed=[("가.pdf", "1.0MB", "2026-11-05 10:00:00")], oldest="2026-11-05 10:00:00", newest="2026-11-05 10:00:00")
        text = "\n".join(file_summary({"방": r}, True))
        self.assertIn("받을 파일 1개", text)
        self.assertIn("가.pdf", text)
        self.assertIn("다음에 다시 1", text)
        self.assertIn("못 받음 1 (만료)", text)

    def test_summary_에_파일_줄이_붙는다(self):
        self.assertIn("받은 파일 2개", summary([], {}, [], False, {"방": file_report(got=2)}))
        self.assertNotIn("파일", summary([], {}, [], False))


if __name__ == "__main__":
    unittest.main()
