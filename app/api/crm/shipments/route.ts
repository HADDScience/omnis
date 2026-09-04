import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { CrmShipmentKind, CrmShipmentStatus } from "@/generated/prisma"
import { nextCode } from "@/lib/crm"
import { createWithUniqueCode } from "@/lib/crm-server"

export const runtime = "nodejs"

const createSchema = z.object({
  shippedAt: z.coerce.date(),
  kind: z.enum(CrmShipmentKind).default(CrmShipmentKind.SALE),
  orgId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: z.number().int().min(1, "수량은 1 이상이어야 합니다"),
  status: z.enum(CrmShipmentStatus).default(CrmShipmentStatus.PREPARING),
  quoteId: z.string().uuid().optional().nullable(),
  sampleRequestId: z.string().uuid().optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
})

/**
 * 출고 한 건. 완제품 재고를 함께 뺀다.
 *
 * 두 일이 한 트랜잭션에서 움직인다 — 따로 두면 "물건은 나갔는데 재고는 그대로" 가
 * 된다. 엑셀이 정확히 그 상태였다: 출고 23건이 있는데 재고의 총 출고량은 0.
 *
 * 재고가 모자라도 막지는 않는다. 실제로 나간 물건을 못 적게 하면 사람이 장부 밖에서
 * 처리하고, 그때부터 장부는 아무 쓸모가 없다. 대신 음수가 되면 화면이 빨갛게 알린다.
 */
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
  const { orgId, productId, quoteId, sampleRequestId, quantity, shippedAt, ...rest } = parsed.data

  const product = await prisma.crmProduct.findUnique({ where: { id: productId } })
  if (!product) return NextResponse.json({ error: "제품을 찾을 수 없습니다" }, { status: 404 })

  const shipment = await createWithUniqueCode(() =>
    prisma.$transaction(async (tx) => {
      const codes = (await tx.crmShipment.findMany({ select: { code: true } })).map((s) => s.code)
      const created = await tx.crmShipment.create({
        data: {
          ...rest,
          code: nextCode("SH", codes),
          shippedAt,
          quantity,
          org: { connect: { id: orgId } },
          product: { connect: { id: productId } },
          quote: quoteId ? { connect: { id: quoteId } } : undefined,
          sampleRequest: sampleRequestId ? { connect: { id: sampleRequestId } } : undefined,
        },
      })
      await tx.crmStockMove.create({
        data: {
          movedAt: shippedAt,
          productId,
          direction: "OUT",
          quantity,
          note: `출고 ${created.code}`,
          shipmentId: created.id,
        },
      })
      return created
    })
  )

  return NextResponse.json(shipment, { status: 201 })
}
