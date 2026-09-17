import type { Metadata } from "next"
import Link from "next/link"
import { Header } from "@/components/layout/header"
import { CrmNav } from "@/components/crm/crm-nav"
import { NewRecordButton } from "@/components/crm/new-record-button"
import { Badge } from "@/components/ui/badge"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { prisma } from "@/lib/db"
import { won } from "@/lib/crm"
import { ymd } from "@/lib/company-context"
import { apiUrl } from "@/lib/base-path"
import { IS_DEMO } from "@/lib/demo"
import { OVERDUE_DAYS, receivableChains } from "@/lib/crm-receivables"

export const metadata: Metadata = { title: "세금계산서 · CRM" }
export const dynamic = "force-dynamic"

/**
 * 발행된 세금계산서. 공급가액(부가세 제외)을 매출로 센다.
 * 결산 전인 해의 잠정 매출이 여기서 나온다 — HADD DB 「회사 정보」 가 같은 표를 읽는다.
 */
export default async function CrmInvoicesPage() {
  const invoices = await prisma.taxInvoice.findMany({
    orderBy: [{ issuedOn: "desc" }, { approvalNo: "desc" }],
    include: {
      items: { orderBy: { lineNo: "asc" }, select: { id: true, name: true, supplyKrw: true, category: true } },
      org: { select: { id: true, name: true } },
      quote: { select: { id: true, code: true } },
    },
  })

  // 받을 돈 — 수정세금계산서를 당초 승인번호로 묶어 센다(lib/crm-receivables)
  const chains = await receivableChains("SALE")
  const owing = chains.filter((c) => c.remaining > 0)
  const overdue = owing.filter((c) => c.overdue)
  const chainByInvoice = new Map(chains.map((c) => [c.invoiceId, c]))

  const years = new Map<string, typeof invoices>()
  for (const inv of invoices) {
    const y = String(inv.issuedOn.getUTCFullYear())
    years.set(y, [...(years.get(y) ?? []), inv])
  }

  return (
    <>
      <Header crumbs={["CRM", "세금계산서"]} actions={<NewRecordButton />} />
      <div className="mx-auto w-full max-w-[1100px] px-4 py-6 sm:px-6">
        <CrmNav />
        <div className="mb-4 flex flex-wrap items-baseline gap-3">
          <h1 className="text-[18px] font-bold tracking-[-0.02em]">세금계산서</h1>
          <span className="text-[13px] text-muted-foreground">
            {invoices.length}장 · 매출은 공급가액(부가세 제외) · 견적과 합계 · 날짜가 맞으면 저절로 잇는다
          </span>
        </div>

        {/* 여기서 올리지 않는다 — 올리는 입구는 「새로 만들기」 하나다. 이 자리는 「지금 할 일」 을 보여 준다 */}
        {owing.length > 0 && (
          <Link
            href="/crm/payments/new"
            className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border bg-card px-4 py-3 transition-colors hover:bg-muted/40"
          >
            <span className="text-[13px] font-semibold">받을 돈 {owing.length}건 · {won(owing.reduce((a, c) => a + c.remaining, 0))}</span>
            {overdue.length > 0 && (
              <span className="text-[12.5px] font-medium text-destructive">{OVERDUE_DAYS}일 넘은 것 {overdue.length}건</span>
            )}
            <span className="ml-auto text-[12.5px] text-primary">입금 확인 →</span>
          </Link>
        )}

        {invoices.length === 0 ? (
          <Empty className="rounded-xl border border-dashed">
            <EmptyHeader>
              <EmptyTitle>올린 세금계산서가 없습니다</EmptyTitle>
              <EmptyDescription>「새로 만들기 → 세금계산서 등록」 에서 홈택스 목록 엑셀이나 PDF 를 올리면 기관 · 견적에 이어서 쌓입니다.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          [...years.entries()].map(([year, list]) => {
            const sale = list.filter((i) => i.direction === "SALE")
            let product = 0
            let service = 0
            for (const i of sale) {
              for (const it of i.items) {
                if (it.category === "용역") service += Number(it.supplyKrw)
                else product += Number(it.supplyKrw)
              }
            }
            const purchase = list.filter((i) => i.direction === "PURCHASE").reduce((a, i) => a + Number(i.supplyKrw), 0)
            return (
              <section key={year} aria-labelledby={`inv-${year}`} className="mb-6">
                <h2 id={`inv-${year}`} className="mb-2 flex flex-wrap items-baseline gap-x-3 text-[13px] font-semibold">
                  {year}
                  <span className="font-normal text-muted-foreground">
                    매출 {sale.length}장 · {won(product + service)} (제품 {won(product)} · 용역 {won(service)})
                    {purchase > 0 && ` · 매입 ${won(purchase)}`}
                  </span>
                </h2>
                <ul className="flex flex-col gap-1.5">
                  {list.map((inv) => {
                    const counter = inv.direction === "SALE" ? inv.buyerName : inv.supplierName
                    return (
                      <li key={inv.id} className="rounded-lg border bg-card px-3.5 py-2.5">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-[12px] tabular-nums text-muted-foreground">{ymd(inv.issuedOn)}</span>
                          <Badge variant={inv.direction === "SALE" ? "default" : "secondary"}>{inv.direction === "SALE" ? "매출" : "매입"}</Badge>
                          {inv.kind === "수정" && <Badge variant="outline">수정</Badge>}
                          {inv.org ? (
                            <Link href={`/crm/orgs/${inv.org.id}`} className="min-w-0 break-words text-[13.5px] font-medium hover:underline">
                              {inv.org.name}
                            </Link>
                          ) : (
                            <span className="min-w-0 break-words text-[13.5px] font-medium">{counter}</span>
                          )}
                          <span className="ml-auto text-[13px] font-semibold tabular-nums">{won(Number(inv.supplyKrw))}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-muted-foreground">
                          <span className="break-words">{inv.items.map((i) => i.name).join(", ")}</span>
                          {[...new Set(inv.items.map((i) => i.category))].map((c) => (
                            <span key={c}>{c}</span>
                          ))}
                          <span>합계 {won(Number(inv.totalKrw))}</span>
                          {inv.quote ? (
                            <Link href={`/crm/quotes/${inv.quote.id}`} className="hover:underline">
                              견적 {inv.quote.code}
                            </Link>
                          ) : (
                            <span>견적 없음</span>
                          )}
                          {inv.readBy === "vision" && <span>AI 판독</span>}
                          {inv.direction === "SALE" && chainByInvoice.get(inv.id) && (() => {
                            const c = chainByInvoice.get(inv.id)!
                            return c.remaining <= 0 ? (
                              <span className="text-primary">입금 완료</span>
                            ) : (
                              <Link href={`/crm/payments/new?invoice=${inv.id}`} className={c.overdue ? "font-medium text-destructive hover:underline" : "hover:underline"}>
                                {won(c.remaining)} 받을 돈 · {c.days}일째
                              </Link>
                            )
                          })()}
                          {inv.objectKey && !IS_DEMO && (
                            <a href={apiUrl(`/api/crm/invoices/${inv.id}/file`)} target="_blank" rel="noopener noreferrer" className="hover:underline">
                              원본
                            </a>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })
        )}
      </div>
    </>
  )
}
