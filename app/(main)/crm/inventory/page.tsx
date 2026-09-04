import Link from "next/link"
import { Header } from "@/components/layout/header"
import { CrmNav } from "@/components/crm/crm-nav"
import { NewRecordButton } from "@/components/crm/new-record-button"
import { prisma } from "@/lib/db"
import {
  stockBalance,
  gramsPerUnit,
  SHIPMENT_KIND_LABEL,
  SHIPMENT_STATUS_LABEL,
} from "@/lib/crm"
import { Badge } from "@/components/ui/badge"
import { HugeiconsIcon } from "@hugeicons/react"
import { Alert02Icon } from "@hugeicons/core-free-icons"
import { StockPanel } from "@/components/crm/stock-panel"

export const dynamic = "force-dynamic"

export default async function CrmInventoryPage() {
  const [products, shipments, productions, orgs] = await Promise.all([
    prisma.crmProduct.findMany({
      where: { archived: false },
      orderBy: { code: "asc" },
      include: { stockMoves: { orderBy: { movedAt: "desc" } } },
    }),
    prisma.crmShipment.findMany({
      orderBy: { shippedAt: "desc" },
      take: 30,
      include: { org: true, product: true, stockMoves: { select: { id: true } } },
    }),
    prisma.crmProduction.findMany({
      orderBy: { producedAt: "desc" },
      take: 20,
      include: { product: true, material: true },
    }),
    prisma.crmOrg.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ])

  const materials = products.filter((p) => p.isMaterial)
  const goods = products.filter((p) => !p.isMaterial)

  const view = (p: (typeof products)[number]) => {
    const { inQty, outQty, balance } = stockBalance(p.stockMoves)
    const per = gramsPerUnit(
      p.volumeMl ? Number(p.volumeMl) : null,
      p.concentrationPct ? Number(p.concentrationPct) : null
    )
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      spec: p.spec,
      kind: p.kind,
      unit: p.stockUnit,
      inQty,
      outQty,
      balance,
      gramsPerUnit: per,
      moves: p.stockMoves.slice(0, 6).map((m) => ({
        id: m.id,
        movedAt: m.movedAt.toISOString().slice(0, 10),
        direction: m.direction,
        quantity: Number(m.quantity),
        note: m.note,
        fromRecord: Boolean(m.productionId || m.shipmentId),
      })),
    }
  }

  return (
    <>
      <Header crumbs={["CRM", "재고·생산"]} actions={<NewRecordButton />} />
      <div className="mx-auto w-full max-w-[1000px] px-6 pb-20 pt-6">
        <CrmNav />

        <StockPanel
          materials={materials.map(view)}
          goods={goods.map(view)}
          productions={productions.map((p) => ({
            id: p.id,
            code: p.code,
            producedAt: p.producedAt.toISOString().slice(0, 10),
            productName: p.product.name,
            productSpec: p.product.spec,
            quantity: p.quantity,
            materialName: p.material.name,
            materialGrams: Number(p.materialGrams),
            note: p.note,
          }))}
          orgs={orgs}
        />

        <section className="mt-8">
          <h2 className="mb-3 text-[16px] font-bold tracking-[-0.02em]">
            출고{" "}
            <span className="text-[13px] font-normal text-muted-foreground">
              최근 {shipments.length}건
            </span>
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
                    <th className="px-3 py-2 text-left font-semibold">재고</th>
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
                      <td className="px-3 py-2.5 text-[11px] text-muted-foreground">
                        {s.stockMoves.length > 0 ? "차감됨" : "미반영"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="mt-2.5 flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <HugeiconsIcon icon={Alert02Icon} size={13} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              「출고 적기」로 적은 건은 완제품 재고에서 바로 빠집니다. 엑셀에서 넘어온 지난
              출고는 「미반영」입니다 — 어떤 생산분에서 나갔는지 기록이 없어 지금 빼면 숫자를
              지어내는 셈이라 그대로 뒀습니다. 실제 수량은 「재고 맞추기」의 「센 값으로 맞추기」로
              맞출 수 있습니다.
            </span>
          </p>
        </section>
      </div>
    </>
  )
}
