import Link from "next/link"
import { notFound } from "next/navigation"
import { Header } from "@/components/layout/header"
import { prisma } from "@/lib/db"
import { quoteTotals, won, ORG_TYPE_LABEL } from "@/lib/crm"
import { QuoteStatusControl } from "@/components/crm/quote-status"
import { DeleteRecordButton } from "@/components/crm/delete-record-button"

export const dynamic = "force-dynamic"

export default async function QuoteDetailPage({
  params,
}: {
  params: Promise<{ quoteId: string }>
}) {
  const { quoteId } = await params
  // 규칙 21 — detail loader 는 1-hop 관계를 기본 include
  const q = await prisma.crmQuote.findUnique({
    where: { id: quoteId },
    include: {
      org: true,
      contact: true,
      membership: true,
      items: { include: { product: true }, orderBy: { sortOrder: "asc" } },
      shipments: { select: { id: true } },
    },
  })
  if (!q) notFound()

  const t = quoteTotals(q.items, q.discountAmount, q.vatRate)

  return (
    <>
      <Header crumbs={["CRM", "견적", q.code]} />
      <div className="mx-auto w-full max-w-[860px] px-6 pb-20 pt-6">
        <div className="mb-4 flex flex-wrap items-baseline gap-3">
          <h1 className="font-mono text-[18px] font-bold">{q.code}</h1>
          <span className="text-[13px] text-muted-foreground">
            {q.quotedAt.toISOString().slice(0, 10)}
          </span>
        </div>
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <QuoteStatusControl
            quoteId={q.id}
            status={q.status}
            taxInvoicedAt={q.taxInvoicedAt?.toISOString() ?? null}
          />
          <DeleteRecordButton
            endpoint={`/api/crm/quotes/${q.id}`}
            redirectTo="/crm/quotes"
            title="이 견적을 지울까요?"
            code={q.code}
            consequences={[
              `품목 ${q.items.length}건과 금액 기록(${won(t.total)})이 함께 사라집니다`,
              q.shipments.length > 0
                ? `출고 ${q.shipments.length}건은 남지만 이 견적과의 연결이 끊깁니다`
                : "딸린 출고는 없습니다",
              "기관·담당자는 그대로 남습니다",
            ]}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <div className="min-w-0">
            <section className="rounded-xl border bg-card p-4">
              <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                품목
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead className="border-b text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="pb-1.5 text-left font-semibold">제품</th>
                      <th className="pb-1.5 text-right font-semibold">수량</th>
                      <th className="pb-1.5 text-right font-semibold">단가</th>
                      <th className="pb-1.5 text-right font-semibold">금액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.items.map((it) => (
                      <tr key={it.id} className="border-b last:border-0">
                        <td className="py-2.5">
                          <div className="font-medium">{it.product.name}</div>
                          {it.product.spec && (
                            <div className="text-[11px] text-muted-foreground">
                              {it.product.spec}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 text-right font-mono">{it.quantity}</td>
                        <td className="py-2.5 text-right font-mono text-muted-foreground">
                          {won(it.unitPrice)}
                        </td>
                        <td className="py-2.5 text-right font-mono font-medium">
                          {won(it.quantity * it.unitPrice)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <dl className="mt-4 flex flex-col gap-1.5 border-t pt-3 text-[13px]">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">공급가</dt>
                  <dd className="font-mono">{won(t.supply)}</dd>
                </div>
                {t.discount > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">
                      할인{q.membership && <span className="ml-1.5 text-[11px] text-primary">HRP</span>}
                    </dt>
                    <dd className="font-mono">−{won(t.discount)}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">소계</dt>
                  <dd className="font-mono">{won(t.subtotal)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">부가세 {q.vatRate}%</dt>
                  <dd className="font-mono">{won(t.vat)}</dd>
                </div>
                <div className="flex justify-between border-t pt-2 text-[15px] font-bold">
                  <dt>실 합계</dt>
                  <dd className="font-mono">{won(t.total)}</dd>
                </div>
              </dl>
            </section>

            {q.note && (
              <section className="mt-4 rounded-xl border bg-card p-4">
                <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  비고
                </h2>
                <p className="whitespace-pre-wrap text-[13px]">{q.note}</p>
              </section>
            )}
          </div>

          <aside className="flex flex-col gap-4">
            <section className="rounded-xl border bg-card p-4">
              <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                받는 곳
              </h2>
              <Link
                href={`/crm/orgs/${q.org.id}`}
                className="text-[14px] font-semibold hover:underline"
              >
                {q.org.name}
              </Link>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {ORG_TYPE_LABEL[q.org.type]} · {q.org.code}
              </div>
              {q.contact && (
                <div className="mt-3 border-t pt-3">
                  <div className="text-[13px] font-medium">
                    {q.contact.name}
                    {q.contact.title && (
                      <span className="ml-1.5 text-[11px] text-muted-foreground">
                        {q.contact.title}
                      </span>
                    )}
                  </div>
                  {q.contact.phone && (
                    <div className="mt-0.5 text-[12px] text-muted-foreground">{q.contact.phone}</div>
                  )}
                  {q.contact.email && (
                    <div className="text-[12px] text-muted-foreground">{q.contact.email}</div>
                  )}
                </div>
              )}
            </section>

            {q.taxInvoicedAt && (
              <section className="rounded-xl border bg-card p-4">
                <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  세금계산서
                </h2>
                <div className="text-[13px]">{q.taxInvoicedAt.toISOString().slice(0, 10)} 발행</div>
              </section>
            )}
          </aside>
        </div>
      </div>
    </>
  )
}
