import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

export const runtime = "nodejs"

const createSchema = z.object({
  movedAt: z.coerce.date(),
  productId: z.string().uuid(),
  direction: z.enum(["IN", "OUT"]),
  quantity: z.number().positive("수량은 0보다 커야 합니다"),
  note: z.string().trim().max(500).optional().nullable(),
})

/** 재고 장부에 한 줄 직접 적는다 — 원료 입고, 폐기, 실사 보정 같은 것. */
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const parsed = createSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "잘못된 입력" },
      { status: 400 }
    )
  }
  const { productId, ...rest } = parsed.data
  const product = await prisma.crmProduct.findUnique({ where: { id: productId } })
  if (!product) return NextResponse.json({ error: "품목을 찾을 수 없습니다" }, { status: 404 })

  const move = await prisma.crmStockMove.create({
    data: { ...rest, note: rest.note ?? null, product: { connect: { id: productId } } },
  })
  return NextResponse.json(move, { status: 201 })
}

/** 장부 한 줄 지우기. 생산·출고에서 파생된 줄은 그쪽에서 지워야 한다. */
export async function DELETE(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const body = z
    .object({ id: z.string().uuid() })
    .safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: "잘못된 입력" }, { status: 400 })

  const move = await prisma.crmStockMove.findUnique({ where: { id: body.data.id } })
  if (!move) return NextResponse.json({ error: "찾을 수 없습니다" }, { status: 404 })
  if (move.productionId || move.shipmentId) {
    return NextResponse.json(
      { error: "생산·출고에서 나온 줄입니다. 그 기록을 지워야 함께 사라집니다" },
      { status: 400 }
    )
  }
  await prisma.crmStockMove.delete({ where: { id: body.data.id } })
  return NextResponse.json({ ok: true })
}
