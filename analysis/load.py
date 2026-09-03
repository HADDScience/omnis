"""카카오톡 대화 로드 + 이름 정규화. 다른 분석 스크립트가 공통으로 import."""
import csv, datetime, re, os

FILES = [
    ("인턴방", "/Users/jeong-uchang/Downloads/KakaoTalk_Chat_하드사이언스 인턴방_2026-06-14-21-13-32.csv"),
    ("수원대방", "/Users/jeong-uchang/Downloads/KakaoTalk_Chat_HADD-수원대_2026-06-14-21-13-06.csv"),
    ("상무님1:1", "/Users/jeong-uchang/Downloads/KakaoTalk_Chat_Yuhooi_2026-08-26-10-38-35.csv"),
]
# 카톡 표시명 → 실제 구성원
ALIAS = {
    "김아리 박사님": "김아리", "노혜린 하드사이언스 과장님": "노혜린",
    "허채정 하드사이언스 대표님": "허채정", "Yuhooi": "윤훈",
    "주용석(데과21)": "주용석",
}
ROLE = {  # 조직 내 위치 (직급)
    "허채정": "대표", "윤훈": "상무", "김아리": "팀장", "노혜린": "과장",
    "정우창": "사원", "주용석": "인턴", "박소정": "인턴", "주진호": "인턴",
}
MEDIA = {"Photo", "Video", "Voice Call", "Emoticon", "Sticker", "Audio", "Map"}

def is_media(m):
    return m in MEDIA or m.startswith("File:") or re.fullmatch(r"\d+:\d+", m or "")

def load():
    rows = []
    for room, fn in FILES:
        if not os.path.exists(fn):
            continue
        prev = None
        for r in csv.DictReader(open(fn, encoding="utf-8-sig")):
            if not r["Date"].strip():
                if prev is not None:
                    prev["msg"] += "\n" + r["Message"]      # 여러 줄 메시지의 연속행
                continue
            u = ALIAS.get(r["User"].strip(), r["User"].strip())
            m = {
                "room": room,
                "dt": datetime.datetime.strptime(r["Date"], "%Y-%m-%d %H:%M:%S"),
                "user": u, "role": ROLE.get(u, "기타"),
                "msg": r["Message"], "media": is_media(r["Message"]),
            }
            rows.append(m); prev = m
    rows.sort(key=lambda x: (x["room"], x["dt"]))
    return rows

def sessions(rows, gap_min=60):
    out, cur = [], None
    for r in rows:
        if cur and r["room"] == cur[-1]["room"] and (r["dt"] - cur[-1]["dt"]).total_seconds() <= gap_min * 60:
            cur.append(r)
        else:
            if cur: out.append(cur)
            cur = [r]
    if cur: out.append(cur)
    return out
