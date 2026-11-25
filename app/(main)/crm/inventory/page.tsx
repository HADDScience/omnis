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
import { StockPanel } from "@/components/crm/stock-panel"
import { amountText, gelLots, isGelType, resolveMaterial, rowProductLabel } from "@/lib/crm-gel"
import { materialMapSetting, materialsWithStock } from "@/lib/crm-gel-server"

export const dynamic = "force-dynamic"

export default async function CrmInventoryPage() {
  const [products, shipments, productions, orgs, mats, mapSetting] = await Promise.all([
    prisma.crmProduct.findMany({
      where: { archived: false },
      orderBy: { code: "asc" },
      include: { stockMoves: { orderBy: { movedAt: "desc" } } },
    }),
    prisma.crmShipment.findMany({
      orderBy: { shippedAt: "desc" },
      take: 30,
      include: { org: true, product: true, sampleRequest: { select: { code: true } }, _count: { select: { stockMoves: true } } },
    }),
    prisma.crmProduction.findMany({
      orderBy: { producedAt: "desc" },
      take: 20,
      include: { product: true, material: true },
    }),
    prisma.crmOrg.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    materialsWithStock(),
    materialMapSetting(),
  ])

  const materials = products.filter((p) => p.isMaterial)
  const goods = products.filter((p) => !p.isMaterial && !p.gelType)
  const gels = products.flatMap((p) => {
    if (!isGelType(p.gelType)) return []
    const m = resolveMaterial(p.gelType, mapSetting, mats)
    const mat = m ? mats.find((x) => x.id === m.id) ?? null : null
    return [{ id: p.id, code: p.code, name: p.name, gelType: p.gelType, lots: gelLots(p.stockMoves), material: mat ? { id: mat.id, name: mat.name, grams: mat.grams } : null }]
  })
  // 사진 이름 — 생산 고치기 팝업이 썸네일과 이름을 보여 준다
  const photoIds = [...new Set(productions.flatMap((p) => p.photoFileIds))]
  const photoRows = photoIds.length ? await prisma.file.findMany({ where: { id: { in: photoIds } }, select: { id: true, name: true } }) : []
  const photoName = new Map(photoRows.map((f) => [f.id, f.name]))

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
      // 용량 정렬용 — "1ml"·"2ml"·"5ml" 을 문자열로 세우면 10ml 이 1ml 뒤가 아니라
      // 1ml 옆에 붙는다. 숫자로 세운다.
      volumeMl: p.volumeMl ? Number(p.volumeMl) : null,
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
          gels={gels}
          productions={productions.map((p) => ({
            id: p.id,
            code: p.code,
            productId: p.productId,
            producedAt: p.producedAt.toISOString().slice(0, 10),
            productName: p.product.name,
            concentrationPct: p.concentrationPct != null ? Number(p.concentrationPct) : null,
            totalMl: Number(p.totalMl ?? 0),
            materialId: p.materialId,
            materialName: p.material?.name ?? null,
            materialGrams: Number(p.materialGrams),
            note: p.note,
            photos: p.photoFileIds.filter((id) => photoName.has(id)).map((id) => ({ id, name: photoName.get(id)! })),
          }))}
          shipments={shipments.map((s) => ({
            id: s.id,
            code: s.code,
            shippedAt: s.shippedAt.toISOString().slice(0, 10),
            kind: s.kind,
            kindLabel: SHIPMENT_KIND_LABEL[s.kind],
            statusLabel: SHIPMENT_STATUS_LABEL[s.status],
            orgId: s.orgId,
            orgName: s.org.name,
            productId: s.productId,
            productLabel: rowProductLabel(s.product, { concentrationPct: s.concentrationPct }),
            amount: amountText(s, s.product.gelType),
            concentrationPct: s.concentrationPct != null ? Number(s.concentrationPct) : null,
            volumeMl: s.volumeMl != null ? Number(s.volumeMl) : null,
            quantity: s.quantity,
            note: s.note,
            ledger: s._count.stockMoves > 0,
            sampleCode: s.sampleRequest?.code ?? null,
          }))}
          orgs={orgs}
        />

      </div>
    </>
  )
}
