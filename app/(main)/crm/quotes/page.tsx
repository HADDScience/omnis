import Link from "next/link"
import { Header } from "@/components/layout/header"
import { CrmNav } from "@/components/crm/crm-nav"
import { prisma } from "@/lib/db"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { HugeiconsIcon } from "@hugeicons/react"
import { PlusSignIcon, Invoice01Icon } from "@hugeicons/core-free-icons"
import { quoteTotals, won, QUOTE_STATUS_LABEL } from "@/lib/crm"
import type { CrmQuoteStatus } from "@/generated/prisma"

export const dynamic = "force-dynamic"

const STATUS_VARIANT: Record<CrmQuoteStatus, "default" | "secondary" | "outline"> = {
  DRAFT: "outline",
  SENT: "secondary",
  DONE: "default",
  CANCELLED: "outline",
}

export default async function CrmQuotesPage() {
  const quotes = await prisma.crmQuote.findMany({
    orderBy: { quotedAt: "desc" },
    include: {
      org: true,
      contact: true,
      items: { include: { product: true }, orderBy: { sortOrder: "asc" } },
    },
  })

  const grand = quotes.reduce(
    (a, q) => a + quoteTotals(q.items, q.discountAmount, q.vatRate).total,
    0
  )

  return (
    <>
      <Header
        crumbs={["CRM", "견적"]}
        actions={
          <Button size="sm" render={<Link href="/crm/quotes/new" />} className="gap-1.5">
            <HugeiconsIcon icon={PlusSignIcon} size={15} aria-hidden />
            새 견적
          </Button>
        }
      />
      <div className="mx-auto w-full max-w-[1100px] px-6 py-6">
        <CrmNav />
        <div className="mb-4 flex items-baseline gap-3">
          <h1 className="text-[18px] font-bold tracking-[-0.02em]">견적</h1>
          <span className="text-[13px] text-muted-foreground">
            {quotes.length}건 · 실 합계 {won(grand)}
          </span>
        </div>

        {quotes.length === 0 ? (
          <div className="rounded-xl border bg-card px-6 py-16 text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <HugeiconsIcon icon={Invoice01Icon} size={20} aria-hidden />
            </div>
            <p className="text-[14px] font-semibold">아직 견적이 없습니다</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              첫 견적을 만들면 기관·담당자도 그 자리에서 함께 등록할 수 있어요.
            </p>
            <Button size="sm" className="mt-4" render={<Link href="/crm/quotes/new" />}>
              새 견적 만들기
            </Button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="border-b bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">견적번호</th>
                    <th className="px-3 py-2 text-left font-semibold">일자</th>
                    <th className="px-3 py-2 text-left font-semibold">기관 · 담당자</th>
                    <th className="px-3 py-2 text-left font-semibold">품목</th>
                    <th className="px-3 py-2 text-right font-semibold">할인</th>
                    <th className="px-3 py-2 text-right font-semibold">실 합계</th>
                    <th className="px-3 py-2 text-left font-semibold">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((q) => {
                    const t = quoteTotals(q.items, q.discountAmount, q.vatRate)
                    return (
                      <tr key={q.id} className="border-b last:border-0 hover:bg-muted/40">
                        <td className="px-3 py-2.5">
                          <Link
                            href={`/crm/quotes/${q.id}`}
                            className="font-mono text-[12px] font-medium hover:underline"
                          >
                            {q.code}
                          </Link>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                          {q.quotedAt.toISOString().slice(0, 10)}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-medium">{q.org.name}</div>
                          {q.contact && (
                            <div className="text-[11px] text-muted-foreground">
                              {q.contact.name}
                              {q.contact.title && ` ${q.contact.title}`}
                            </div>
                          )}
                        </td>
                        <td className="max-w-[240px] px-3 py-2.5">
                          <div className="truncate">{q.items[0]?.product.name ?? "—"}</div>
                          {q.items.length > 1 && (
                            <div className="text-[11px] text-muted-foreground">
                              외 {q.items.length - 1}건
                            </div>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right text-muted-foreground">
                          {t.discount > 0 ? `−${won(t.discount)}` : "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold">
                          {won(t.total)}
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge variant={STATUS_VARIANT[q.status]}>
                            {QUOTE_STATUS_LABEL[q.status]}
                          </Badge>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
