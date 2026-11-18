import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { deleteShipment, updateShipment } from "@/lib/crm-ops"

export const runtime = "nodejs"

/** 출고 고치기 — 수량을 고치면 재고 장부도 따라간다(lib/crm-ops.ts updateShipment) */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ shipmentId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const { shipmentId } = await params
  const r = await updateShipment(shipmentId, await req.json().catch(() => null))
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json(r.value)
}

/** 출고를 지우면 딸린 재고 줄도 함께 사라진다 (스키마의 onDelete: Cascade). */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ shipmentId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const { shipmentId } = await params
  const r = await deleteShipment(shipmentId)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true, code: r.value.code })
}
