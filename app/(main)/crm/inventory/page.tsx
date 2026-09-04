import { Header } from "@/components/layout/header"
import { CrmNav } from "@/components/crm/crm-nav"
import { prisma } from "@/lib/db"
import { stockBalance, SHIPMENT_KIND_LABEL, SHIPMENT_STATUS_LABEL } from "@/lib/crm"
import { Badge } from "@/components/ui/badge"
import { HugeiconsIcon } from "@hugeicons/react"
import { Alert02Icon } from "@hugeicons/core-free-icons"
import Link from "next/link"

export const dynamic = "force-dynamic"

export default async function CrmInventoryPage() {
  const [materials, shipments] = await Promise.all([
    prisma.crmProduct.findMany({
      where: { isMaterial: true },
      orderBy: { code: "asc" },
      include: { stockMoves: { orderBy: { movedAt: "desc" } } },
    }),
    prisma.crmShipment.findMany({
      orderBy: { shippedAt: "desc" },
      include: { org: true, product: true },
    }),
  ])

  return (
    <>
      <Header crumbs={["CRM", "재고·출고"]} />
      <div className="mx-auto w-full max-w-[1000px] px-6 pb-20 pt-6">
        <CrmNav />
        <section>
          <h1 className="mb-3 text-[18px] font-bold tracking-[-0.02em]">원료 재고</h1>
          <div className="flex flex-col gap-2">
            {materials.map((m) => {
              const { inQty, outQty, balance } = stockBalance(m.stockMoves)
              return (
                <div key={m.id} className="rounded-xl border bg-card p-4">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-[14px] font-semibold">{m.name}</span>
                    {m.spec && (
                      <span className="text-[12px] text-muted-foreground">{m.spec}</span>
                    )}
                    <span className="ml-auto font-mono text-[15px] font-bold">{balance}</span>
                    <span className="text-[12px] text-muted-foreground">개 남음</span>
                  </div>
                  <div className="mt-1 flex gap-3 font-mono text-[11px] text-muted-foreground">
                    <span>입고 {inQty}</span>
                    <span>출고 {outQty}</span>
                  </div>

                  {m.stockMoves.length > 0 && (
                    <div className="mt-3 flex flex-col gap-1 border-t pt-2.5">
                      {m.stockMoves.map((mv) => (
                        <div key={mv.id} className="flex items-baseline gap-2 text-[12px]">
                          <span className="font-mono text-muted-foreground">
                            {mv.movedAt.toISOString().slice(0, 10)}
                          </span>
                          <Badge variant={mv.direction === "IN" ? "secondary" : "outline"}>
                            {mv.direction === "IN" ? "입고" : "출고"}
                          </Badge>
                          <span className="font-mono">{mv.quantity}</span>
                          {mv.note && (
                            <span className="text-muted-foreground">{mv.note}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <p className="mt-2.5 flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <HugeiconsIcon icon={Alert02Icon} size={13} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              현재고는 입고·출고 장부를 더해서 구합니다. 완제품 출고는 원료를 자동으로
              깎지 않아요 — 제품 하나에 원료가 얼마나 드는지가 아직 어디에도 없습니다.
              원료를 썼으면 출고 줄을 직접 남겨 주세요.
            </span>
          </p>
        </section>

        <section className="mt-8">
          <h2 className="mb-3 text-[16px] font-bold tracking-[-0.02em]">
            출고 <span className="text-[13px] font-normal text-muted-foreground">{shipments.length}건</span>
          </h2>
          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="border-b bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">번호</th>
                    <th className="px-3 py-2 text-left font-semibold">출고일</th>
                    <th className="px-3 py-2 text-left font-semibold">유형</th>
                    <th className="px-3 py-2 text-left font-semibold">기관</th>
                    <th className="px-3 py-2 text-left font-semibold">제품</th>
                    <th className="px-3 py-2 text-right font-semibold">수량</th>
                    <th className="px-3 py-2 text-left font-semibold">배송</th>
                  </tr>
                </thead>
                <tbody>
                  {shipments.map((s) => (
                    <tr key={s.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="px-3 py-2.5 font-mono text-[12px]">{s.code}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                        {s.shippedAt.toISOString().slice(0, 10)}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge variant={s.kind === "SALE" ? "default" : "outline"}>
                          {SHIPMENT_KIND_LABEL[s.kind]}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5">
                        <Link href={`/crm/orgs/${s.orgId}`} className="hover:underline">
                          {s.org.name}
                        </Link>
                      </td>
                      <td className="max-w-[220px] truncate px-3 py-2.5">{s.product.name}</td>
                      <td className="px-3 py-2.5 text-right font-mono">{s.quantity}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {SHIPMENT_STATUS_LABEL[s.status]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </>
  )
}
