// 회사 Context 화면 · 도구가 함께 쓰는 이름표와 계산.
// 설계: mydocs/plans/2026-09-14-company-context.md
import { prisma } from "@/lib/db"
import type { FigureBasis, RecordKind } from "@/generated/prisma/client"

export const RECORD_KIND_LABEL: Record<RecordKind, string> = {
  GRANT: "지원사업",
  AWARD: "수상",
  EXHIBITION: "학회·전시",
  FORUM: "포럼·세미나",
  EDUCATION: "교육",
  NETWORKING: "네트워킹",
  INTERNAL: "내부행사",
  MILESTONE: "주요",
}

/** 확정 = 결산서 · 잠정 = 결산 전 세금계산서 합(저장하지 않는다) · 계획 = 예상·추정 */
export const BASIS_LABEL: Record<FigureBasis | "PROVISIONAL", string> = {
  CONFIRMED: "확정",
  PROVISIONAL: "잠정",
  PLANNED: "계획",
}

export const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null)

/** 기간은 원문을 먼저 보여 준다 — 엑셀 표기가 20종이라 파싱값만 쓰면 뜻이 상한다 */
export function periodText(r: { periodRaw: string | null; startsOn: Date | null; endsOn: Date | null }): string {
  if (r.periodRaw) return r.periodRaw
  if (!r.startsOn) return "날짜 없음"
  const s = ymd(r.startsOn)!
  const e = ymd(r.endsOn)
  return e && e !== s ? `${s} ~ ${e}` : s
}

/** 타일처럼 좁은 자리용 금액 — 3.07억 · 3,475만 · 800원 */
export function compactWon(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e8) return `${(n / 1e8).toFixed(2).replace(/\.?0+$/, "")}억`
  if (abs >= 1e4) return `${Math.round(n / 1e4).toLocaleString("ko-KR")}만`
  return `${n.toLocaleString("ko-KR")}원`
}

export interface InvoiceRevenue {
  year: number
  product: number
  service: number
  total: number
  invoices: number
  lastIssuedOn: Date | null
}

/**
 * 한 해의 매출 세금계산서 공급가액 합 (제품 · 용역). 결산 전인 해의 잠정 매출이고,
 * 결산이 끝난 해에는 결산서 매출과 대조하는 데 쓴다. 저장하지 않고 매번 센다.
 */
export async function invoiceRevenue(year: number): Promise<InvoiceRevenue> {
  const from = new Date(Date.UTC(year, 0, 1))
  const to = new Date(Date.UTC(year + 1, 0, 1))
  const items = await prisma.taxInvoiceItem.findMany({
    where: { invoice: { direction: "SALE", issuedOn: { gte: from, lt: to } } },
    select: { supplyKrw: true, category: true, invoice: { select: { id: true, issuedOn: true } } },
  })
  let product = 0
  let service = 0
  let lastIssuedOn: Date | null = null
  const ids = new Set<string>()
  for (const i of items) {
    if (i.category === "용역") service += Number(i.supplyKrw)
    else product += Number(i.supplyKrw)
    ids.add(i.invoice.id)
    if (!lastIssuedOn || i.invoice.issuedOn > lastIssuedOn) lastIssuedOn = i.invoice.issuedOn
  }
  return { year, product, service, total: product + service, invoices: ids.size, lastIssuedOn }
}
