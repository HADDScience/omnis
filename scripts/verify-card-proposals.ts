// 카드 제안의 날짜·근거 규칙 — 옛 근거가 최신 결론을 덮지 않게 하는 결정적인 부분만 잰다.
//   npx tsx scripts/verify-card-proposals.ts
import { latestEvidenceAt, mergeSourceRefs, type SourceRef } from "../lib/card-proposals"

let fail = 0
const check = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? "✓" : "✗"} ${label} → ${JSON.stringify(got)}${ok ? "" : ` (기대 ${JSON.stringify(want)})`}`)
}

const a: SourceRef = { kind: "task", id: "a", label: "Neurogel 상표권 로고 제작", at: "2025-10-29" }
const b: SourceRef = { kind: "task", id: "b", label: "애드힐 영문표기 확정", at: "2026-08-27" }

check("가장 늦은 날짜", latestEvidenceAt([a, b]), "2026-08-27")
check("순서가 바뀌어도 같다", latestEvidenceAt([b, a]), "2026-08-27")
// 거부되어야 하는 것 — 날짜를 지어내지 않는다
check("날짜 없는 옛 근거뿐 → null", latestEvidenceAt([{ kind: "task", id: "x", label: "옛 근거" }]), null)
check("배열이 아님 → null", latestEvidenceAt({ at: "2026-01-01" }), null)
check("null → null", latestEvidenceAt(null), null)
check("옛 근거가 늦게 와도 최신 날짜는 그대로", latestEvidenceAt(mergeSourceRefs([b], [a])), "2026-08-27")

check("합치면 이전 근거가 남는다", mergeSourceRefs([a], [b]).map((r) => r.id), ["a", "b"])
check("같은 id 는 하나로, 새 것이 이긴다", mergeSourceRefs([a], [{ ...a, label: "새 이름" }]).map((r) => r.label), ["새 이름"])
check("이전이 비어 있어도 된다", mergeSourceRefs(null, [b]).map((r) => r.id), ["b"])

console.log(fail === 0 ? "\n전부 통과" : `\n${fail}건 실패`)
process.exit(fail === 0 ? 0 : 1)
