// 지식 카드 분류 엄격 모드 — 목록 밖 분류는 거부되어야 한다.
//   npx tsx scripts/verify-knowledge-categories.ts
import { KNOWLEDGE_CATEGORIES, matchCategory } from "../lib/knowledge-categories"

let fail = 0
const check = (label: string, got: unknown, want: unknown) => {
  const ok = got === want
  if (!ok) fail++
  console.log(`${ok ? "✓" : "✗"} ${label} → ${JSON.stringify(got)}${ok ? "" : ` (기대 ${JSON.stringify(want)})`}`)
}

// 받아야 하는 것
for (const c of KNOWLEDGE_CATEGORIES) check(`그대로: ${c.name}`, matchCategory(c.name), c.name)
check("띄어쓰기 차이: 회사연혁·실적", matchCategory("회사연혁·실적"), "회사 연혁·실적")
check("띄어쓰기 차이: 업무절차", matchCategory("업무절차"), "업무 절차")

// 거부되어야 하는 것
for (const bad of ["기타", "미분류", "일정", "제품", "", "  ", null, undefined, 3, "기업정보 외"]) {
  check(`거부: ${JSON.stringify(bad)}`, matchCategory(bad), null)
}
check("「기타」 같은 열린 분류가 목록에 없다", KNOWLEDGE_CATEGORIES.some((c) => /기타|미분류/.test(c.name)), false)
check("분류는 6개", KNOWLEDGE_CATEGORIES.length, 6)

console.log(fail === 0 ? "\n전부 통과" : `\n${fail}건 실패`)
process.exit(fail === 0 ? 0 : 1)
