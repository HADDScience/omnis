"""Haiku 분류 결과 집계 + 누락 세션 확인. 결과 파일이 다 들어온 뒤 실행."""
import json, glob, collections, sys, os

BASE = os.path.dirname(os.path.abspath(__file__))

def load_results():
    out, broken = [], []
    for f in sorted(glob.glob(f"{BASE}/data/result*.json")):
        try:
            d = json.load(open(f, encoding="utf-8"))
            out += d if isinstance(d, list) else []
        except Exception as e:
            broken.append((os.path.basename(f), str(e)[:60]))
    return out, broken

def main():
    res, broken = load_results()
    sessions = json.load(open(f"{BASE}/data/sessions.json", encoding="utf-8"))
    have = {r.get("id") for r in res}
    missing = [s for s in sessions if s["id"] not in have]

    print(f"분류 완료 {len(res)}/{len(sessions)}세션 · 누락 {len(missing)}건")
    if broken: print("파싱 실패:", broken)
    if missing:
        # 누락분을 재실행용 청크로 다시 뽑아둔다
        with open(f"{BASE}/data/chunk_missing.txt", "w", encoding="utf-8") as f:
            for s in missing:
                f.write(f"### id={s['id']} 방={s['room']} {s['start']} ({s['n']}건)\n")
                for m in s["msgs"][:40]:
                    f.write(f"  [{m['t']}] {m['u']}: {m['m'][:200]}\n")
                f.write("\n")
        print(f"  → 누락분을 data/chunk_missing.txt 로 저장 (재실행용)")

    print("\n" + "="*56)
    c = collections.Counter(r.get("label") for r in res); t = sum(c.values())
    print("label:", " · ".join(f"{k} {v}({v/t*100:.0f}%)" for k, v in c.most_common()))

    ins = [i for r in res for i in r.get("instructions", [])]
    if ins:
        print(f"\n지시 {len(ins)}건")
        b = collections.Counter(i.get("assignee_basis") for i in ins); tb = sum(b.values())
        print("  담당자 결정:", " · ".join(f"{k} {v}({v/tb*100:.0f}%)" for k, v in b.most_common()))
        closed = sum(1 for i in ins if i.get("closed"))
        print(f"  세션 내 완료: {closed}건 ({closed/len(ins)*100:.0f}%)")
        print("  지시자:", " · ".join(f"{k} {v}" for k, v in collections.Counter(i.get("instructor") for i in ins).most_common(6)))
        print("  담당자:", " · ".join(f"{k} {v}" for k, v in collections.Counter(i.get("assignee") for i in ins if i.get("assignee")).most_common(6)))

    p = collections.Counter(x for r in res for x in r.get("projects", []))
    print(f"\n프로젝트명 {len(p)}종")
    for k, v in p.most_common(20): print(f"  {v:3}  {k}")

    json.dump(res, open(f"{BASE}/data/merged.json", "w"), ensure_ascii=False, indent=1)
    print(f"\n병합본 저장: data/merged.json")

if __name__ == "__main__":
    main()
