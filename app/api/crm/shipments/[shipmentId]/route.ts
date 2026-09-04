import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { CrmShipmentStatus } from "@/generated/prisma"

export const runtime = "nodejs"

const patchSchema = z.object({
  status: z.enum(CrmShipmentStatus).optional(),
  quantity: z.number().int().min(1).optional(),
  note: z.string().trim().max(2000).nullable().optional(),
})

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ shipmentId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const { shipmentId } = await params
  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "잘못된 입력" },
      { status: 400 }
    )
  }

  const before = await prisma.crmShipment.findUnique({ where: { id: shipmentId } })
  if (!before) return NextResponse.json({ error: "출고를 찾을 수 없습니다" }, { status: 404 })

  const shipment = await prisma.$transaction(async (tx) => {
    const updated = await tx.crmShipment.update({ where: { id: shipmentId }, data: parsed.data })
    // 수량을 고치면 재고 장부도 따라가야 한다. 안 그러면 둘이 어긋난 채 남는다.
    if (parsed.data.quantity != null && parsed.data.quantity !== before.quantity) {
      await tx.crmStockMove.updateMany({
        where: { shipmentId },
        data: { quantity: parsed.data.quantity },
      })
    }
    return updated
  })
  return NextResponse.json(shipment)
}

/** 출고를 지우면 딸린 재고 줄도 함께 사라진다 (스키마의 onDelete: Cascade). */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ shipmentId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const { shipmentId } = await params
  const s = await prisma.crmShipment.findUnique({
    where: { id: shipmentId },
    select: { code: true },
  })
  if (!s) return NextResponse.json({ error: "출고를 찾을 수 없습니다" }, { status: 404 })

  await prisma.crmShipment.delete({ where: { id: shipmentId } })
  return NextResponse.json({ ok: true, code: s.code })
}
