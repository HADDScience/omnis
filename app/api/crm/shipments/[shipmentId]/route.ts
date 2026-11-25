import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { writeActivity } from "@/lib/api"
import { deleteShipment, updateShipment } from "@/lib/crm-ops"

export const runtime = "nodejs"

type Ctx = { params: Promise<{ shipmentId: string }> }

/** 출고 고치기 — 팝업이 출고 전체를 보낸다. 재고에 반영된 출고면 장부 줄을 다시 만들어 재고가 다시 계산된다(lib/crm-ops.ts updateShipment, AI 도구 update_shipment 와 같다) */
export async function PATCH(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const { shipmentId } = await params
  const r = await updateShipment(shipmentId, await req.json().catch(() => null))
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  await writeActivity({
    userId: session.user.id, action: "update", entity: "crm.shipment", entityId: shipmentId,
    title: `출고 고침 ${r.value.code} · ${r.value.summary}`,
    metadata: { from: "screen", before: r.value.before, after: r.value.summary, ledger: r.value.ledger },
  })
  return NextResponse.json(r.value)
}

/** 출고를 지우면 딸린 재고 줄도 함께 사라진다 (스키마의 onDelete: Cascade) — AI 도구 delete_shipment 와 같다 */
export async function DELETE(_req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const { shipmentId } = await params
  const r = await deleteShipment(shipmentId)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  await writeActivity({
    userId: session.user.id, action: "delete", entity: "crm.shipment", entityId: shipmentId,
    title: `출고 지움 ${r.value.code} · ${r.value.summary}`,
    metadata: { from: "screen", ledger: r.value.ledger },
  })
  return NextResponse.json({ ok: true, code: r.value.code, summary: r.value.summary })
}
