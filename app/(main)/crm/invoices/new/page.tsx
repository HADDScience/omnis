import { Header } from "@/components/layout/header"
import { prisma } from "@/lib/db"
import { quoteTotals } from "@/lib/crm"
import { InvoiceComposer, type QuoteContext } from "@/components/crm/invoice-composer"

export const dynamic = "force-dynamic"

/** 발행 요청 알림 · 견적 상세에서 열면 ?quote= 로 그 견적이 잡힌다 — 같은 화면, 채워진 채로 */
export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ quote?: string }> }) {
  const { quote: quoteId } = await searchParams
  const q = quoteId
    ? await prisma.crmQuote.findUnique({ where: { id: quoteId }, include: { org: { select: { name: true } }, items: true } })
    : null
  const quote: QuoteContext | null = q
    ? {
        id: q.id,
        code: q.code,
        orgName: q.org.name,
        total: quoteTotals(q.items.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice })), q.discountAmount, q.vatRate).total,
      }
    : null

  return (
    <>
      <Header crumbs={["CRM", "세금계산서", "등록"]} />
      <InvoiceComposer quote={quote} />
    </>
  )
}
