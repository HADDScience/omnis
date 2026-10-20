import Link from "next/link"
import { Header } from "@/components/layout/header"
import { CrmNav } from "@/components/crm/crm-nav"
import { prisma } from "@/lib/db"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { HugeiconsIcon } from "@hugeicons/react"
import { Invoice01Icon } from "@hugeicons/core-free-icons"
import { NewRecordButton } from "@/components/crm/new-record-button"
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
        actions={<NewRecordButton />}
      />
      <div className="mx-auto w-full max-w-[1100px] px-4 py-6 sm:px-6">
        <CrmNav />
        <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
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
          <>
          {/* 좁은 화면: 일곱 칸 표는 기관명이 한 글자씩 세로로 쌓였다 — 견적 한 건을 카드 한 장으로 */}
          <ul className="flex flex-col gap-2 md:hidden">
            {quotes.map((q) => {
              const t = quoteTotals(q.items, q.discountAmount, q.vatRate)
              return (
                <li key={q.id}>
                  <Link
                    href={`/crm/quotes/${q.id}`}
                    className="flex flex-col gap-1.5 rounded-xl border bg-card p-3 transition-colors hover:bg-muted/40"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[12px] font-medium">{q.code}</span>
                      <span className="text-[12px] text-muted-foreground">
                        {q.quotedAt.toISOString().slice(0, 10)}
                      </span>
                      <Badge variant={STATUS_VARIANT[q.status]} className="ml-auto">
                        {QUOTE_STATUS_LABEL[q.status]}
                      </Badge>
                    </div>
                    <div className="min-w-0 text-[13px]">
                      <span className="font-medium">{q.org.name}</span>
                      {q.contact && (
                        <span className="text-muted-foreground">
                          {" · "}
                          {q.contact.name}
                          {q.contact.title && ` ${q.contact.title}`}
                        </span>
                      )}
                    </div>
                    <div className="flex items-baseline gap-2 text-[13px]">
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        {q.items[0]?.product.name ?? "—"}
                        {q.items.length > 1 && ` 외 ${q.items.length - 1}건`}
                      </span>
                      {t.discount > 0 && (
                        <span className="shrink-0 text-[12px] text-muted-foreground">
                          −{won(t.discount)}
                        </span>
                      )}
                      <span className="shrink-0 font-semibold">{won(t.total)}</span>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
          <div className="hidden overflow-hidden rounded-xl border bg-card md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-[13px]">
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
          </>
        )}
      </div>
    </>
  )
}
