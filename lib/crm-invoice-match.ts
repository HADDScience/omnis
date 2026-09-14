// 세금계산서 ↔ CRM 기관 · 견적 잇기. 업로드 화면과 이식 스크립트가 같은 규칙을 쓴다.
//
// 기관: 사업자번호 → 이름 같음 → 「부설」 뒤 이름 → 이름이 서로 포함.
//   포함 후보가 여럿이면 합계가 맞는 견적을 가진 기관을 먼저 고른다.
//   "대구경북과학기술원부설한국뇌연구원" 에는 「대구경북 과학기술원」 과 「한국뇌연구원」 이 둘 다 들어 있다 —
//   긴 이름을 고르면 틀린다(2026-09-14 이식 dry-run). 세금계산서의 실제 공급받는자는 「부설」 뒤다.
// 견적: 같은 기관 · 합계 같음 · 작성일 기준 90일 전 ~ 15일 뒤. 다른 기관에 걸린 견적은 잇지 않고 알려만 준다.
import type { CrmOrg, CrmQuote, CrmQuoteItem } from "@/generated/prisma/client"
import { quoteTotals } from "@/lib/crm"

export const orgKey = (s: string | null | undefined) =>
  (s ?? "")
    .replace(/[\s()［\[\]（）『』「」·.,\-—~㈜]/g, "")
    .replace(/주식회사|산학협력단|\(주\)/g, "")
    .toLowerCase()

type QuoteWithItems = Pick<CrmQuote, "id" | "code" | "quotedAt" | "discountAmount" | "vatRate" | "taxInvoicedAt"> & { items: CrmQuoteItem[] }
export type OrgWithQuotes = Pick<CrmOrg, "id" | "code" | "name" | "bizRegNo"> & { quotes: QuoteWithItems[] }

export type OrgMatchHow = "사업자번호" | "이름" | "부설 뒤 이름" | "포함" | "합계 맞는 견적"

const DAY = 86_400_000

export function matchQuote(org: OrgWithQuotes, totalKrw: number | null, issuedOn: string | null): { id: string; code: string } | null {
  if (totalKrw === null || !issuedOn) return null
  const issued = new Date(`${issuedOn}T00:00:00Z`).getTime()
  return (
    org.quotes
      .map((q) => ({ q, total: Math.round(quoteTotals(q.items, q.discountAmount, q.vatRate).total), gap: (issued - q.quotedAt.getTime()) / DAY }))
      .filter((x) => x.total === totalKrw && x.gap >= -15 && x.gap <= 90)
      .sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap))
      .map((x) => ({ id: x.q.id, code: x.q.code }))[0] ?? null
  )
}

export function matchOrg<T extends OrgWithQuotes>(
  orgs: T[],
  name: string | null,
  bizNo: string | null,
  totalKrw: number | null = null,
  issuedOn: string | null = null
): { org: T | null; how: OrgMatchHow | null } {
  if (bizNo) {
    const byBiz = orgs.find((o) => o.bizRegNo === bizNo)
    if (byBiz) return { org: byBiz, how: "사업자번호" }
  }
  const key = orgKey(name)
  if (key.length < 2) return { org: null, how: null }
  const exact = orgs.find((o) => orgKey(o.name) === key)
  if (exact) return { org: exact, how: "이름" }
  const tail = key.includes("부설") ? key.slice(key.lastIndexOf("부설") + 2) : null
  if (tail) {
    const t = orgs.find((o) => orgKey(o.name) === tail)
    if (t) return { org: t, how: "부설 뒤 이름" }
  }
  const target = tail || key
  const candidates = orgs.filter((o) => {
    const k = orgKey(o.name)
    return k.length >= 3 && (target.includes(k) || k.includes(target))
  })
  if (candidates.length === 0) return { org: null, how: null }
  const withQuote = candidates.filter((o) => matchQuote(o, totalKrw, issuedOn))
  if (withQuote.length === 1) return { org: withQuote[0], how: "합계 맞는 견적" }
  const pool = withQuote.length > 1 ? withQuote : candidates
  const best = pool.sort((a, b) => orgKey(b.name).length - orgKey(a.name).length)[0]
  return { org: best, how: "포함" }
}

/** 이 기관 말고 다른 기관에 합계 · 날짜가 맞는 견적이 있는지 — 잇지 않고 사람에게 보여 준다 */
export function quotesElsewhere(orgs: OrgWithQuotes[], exceptOrgId: string | null, totalKrw: number | null, issuedOn: string | null) {
  return orgs
    .filter((o) => o.id !== exceptOrgId)
    .map((o) => ({ org: o, quote: matchQuote(o, totalKrw, issuedOn) }))
    .filter((x): x is { org: OrgWithQuotes; quote: { id: string; code: string } } => x.quote !== null)
    .map((x) => ({ orgName: x.org.name, quoteCode: x.quote.code }))
}
