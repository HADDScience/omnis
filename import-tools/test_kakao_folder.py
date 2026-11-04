# python3 -m unittest import-tools/test_kakao_folder.py — 카톡 없이 돈다. 이름은 지어낸 값이다.
import os, sys, unittest
sys.path.insert(0, os.path.dirname(__file__))
from kakao_folder import FolderError, check_folder, csv_name_for, csv_room, duplicates, parse_report, room_key, safe_key, summary, switch_to_folder

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


if __name__ == "__main__":
    unittest.main()
