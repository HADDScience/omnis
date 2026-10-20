// 청구처 — 막아야 하는 연결 · 잇기 규칙. DB 를 쓰지 않는다.
//   npx tsx scripts/verify-billing-org.ts
import type { CrmQuoteItem } from "@/generated/prisma/client"
import { billingOrgProblem } from "@/lib/crm"
import { matchOrg, matchQuote, quotesElsewhere, type OrgWithQuotes } from "@/lib/crm-invoice-match"

let fail = 0
const check = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? "✓" : "✗"} ${label} → ${JSON.stringify(got)}${ok ? "" : ` (기대 ${JSON.stringify(want)})`}`)
}

console.log("[1] 청구처로 둘 수 없는 것")
check("자기 자신", billingOrgProblem("A", { id: "A", billingOrgId: null }, false) !== null, true)
check("청구처가 또 청구처를 둔 기관", billingOrgProblem("A", { id: "B", billingOrgId: "C" }, false) !== null, true)
check("이미 남의 청구처인 기관에 청구처를 둔다", billingOrgProblem("B", { id: "C", billingOrgId: null }, true) !== null, true)
check("없는 기관", billingOrgProblem("A", null, false) !== null, true)
check("학과 → 산학협력단 (허용)", billingOrgProblem("A", { id: "B", billingOrgId: null }, false), null)

// 99만원 견적 — 공급가 900,000 + 부가세 10%
const quote = (id: string, quotedAt: string) => ({
  id,
  code: id,
  quotedAt: new Date(`${quotedAt}T00:00:00Z`),
  discountAmount: 0,
  vatRate: 10,
  taxInvoicedAt: null,
  items: [{ quantity: 1, unitPrice: 900_000 } as CrmQuoteItem],
})
const dept = { id: "dept", code: "ORG1", name: "가천대 의과대학", bizRegNo: null, quotes: [quote("HADD-학과", "2025-09-10")] }
const sanhak = (billed: boolean): OrgWithQuotes => ({
  id: "sanhak",
  code: "ORG2",
  name: "가천대학교 산학협력단",
  bizRegNo: "129-82-07687",
  quotes: [],
  billedOrgs: billed ? [{ quotes: dept.quotes }] : [],
})

console.log("\n[2] 산학협력단 앞 계산서 → 학과 견적")
for (const billed of [false, true]) {
  const orgs = [dept, sanhak(billed)]
  const { org, how } = matchOrg(orgs, "가천대학교 산학협력단", "129-82-07687", 990_000, "2025-09-23")
  const tag = billed ? "청구처 있음" : "청구처 없음"
  check(`${tag} — 기관은 산학협력단 그대로`, [org?.name, how], ["가천대학교 산학협력단", "사업자번호"])
  check(`${tag} — 견적`, (org && matchQuote(org, 990_000, "2025-09-23")?.code) ?? null, billed ? "HADD-학과" : null)
  // 청구처가 없으면 지금처럼 「다른 기관에 맞는 견적이 있다」 로만 알린다
  check(`${tag} — 다른 기관 후보 (학과 이름으로 한 번)`, quotesElsewhere(orgs, org?.id ?? null, 990_000, "2025-09-23"), [{ orgName: "가천대 의과대학", quoteCode: "HADD-학과" }])
}

console.log("\n[3] 청구처가 있어도 잇지 않아야 하는 것")
const orgs = [dept, sanhak(true)]
check("합계가 다르면", matchQuote(orgs[1], 1_000_000, "2025-09-23"), null)
check("90일이 넘으면", matchQuote(orgs[1], 990_000, "2025-12-20"), null)
check("다른 기관 앞 계산서가 학과 견적을 다른 기관 후보로 두 번 내지 않는다",
  quotesElsewhere(orgs, null, 990_000, "2025-09-23").length, 1)

console.log(fail ? `\n✗ ${fail}건 실패` : "\n전부 통과")
process.exitCode = fail ? 1 : 0
