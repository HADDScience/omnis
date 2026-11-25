import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { writeActivity } from "@/lib/api"
import { createShipment, shipmentSummary } from "@/lib/crm-ops"
import { prisma } from "@/lib/db"

export const runtime = "nodejs"

/**
 * 출고 한 건. 완제품 재고를 함께 뺀다 — 한 트랜잭션. 재고가 모자라도 막지는 않는다(화면이 빨갛게 알린다).
 * 규칙은 lib/crm-ops.ts createShipment(AI 도구 record_shipment 와 같다). 활동 기록에 남는다.
 */
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const r = await createShipment(await req.json().catch(() => null))
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  const s = r.value
  const product = await prisma.crmProduct.findUnique({ where: { id: s.productId }, select: { name: true, spec: true, gelType: true } })
  const summary = product ? shipmentSummary(product, s) : s.code
  await writeActivity({
    userId: session.user.id, action: "create", entity: "crm.shipment", entityId: s.id,
    title: `출고 ${s.code} · ${summary}`,
    metadata: { from: "screen", kind: s.kind, orgId: s.orgId },
  })
  return NextResponse.json({ ...s, summary }, { status: 201 })
}
