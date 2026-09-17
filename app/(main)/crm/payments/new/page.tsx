import { Header } from "@/components/layout/header"
import { outstanding } from "@/lib/crm-receivables"
import { prisma } from "@/lib/db"
import { PaymentComposer } from "@/components/crm/payment-composer"

export const dynamic = "force-dynamic"

export default async function NewPaymentPage({ searchParams }: { searchParams: Promise<{ invoice?: string }> }) {
  const { invoice } = await searchParams
  const [chains, recorded] = await Promise.all([outstanding("SALE"), prisma.crmPayment.count()])
  return (
    <>
      <Header crumbs={["CRM", "세금계산서", "입금 확인"]} />
      <PaymentComposer
        preselect={invoice ?? null}
        neverRecorded={recorded === 0}
        chains={chains.map((c) => ({
          invoiceId: c.invoiceId,
          issuedOn: c.issuedOn,
          counterName: c.counterName,
          quoteCode: c.quote?.code ?? null,
          total: c.total,
          paid: c.paid,
          remaining: c.remaining,
          days: c.days,
          overdue: c.overdue,
          sheets: c.sheets,
        }))}
      />
    </>
  )
}
