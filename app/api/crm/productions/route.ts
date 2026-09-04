import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { gramsForQuantity, nextCode } from "@/lib/crm"
import { createWithUniqueCode } from "@/lib/crm-server"

export const runtime = "nodejs"

const createSchema = z.object({
  producedAt: z.coerce.date(),
  productId: z.string().uuid(),
  quantity: z.number().int().min(1, "생산 수량은 1 이상이어야 합니다"),
  materialId: z.string().uuid(),
  /** 실제로 쓴 그램. 비우면 용량·농도로 계산한다. */
  materialGrams: z.number().positive().optional(),
  note: z.string().trim().max(2000).optional().nullable(),
})

/**
 * 생산 한 건. 원료를 빼고 완제품을 더한다.
 *
 * 두 장부가 한 트랜잭션에서 함께 움직인다 — 따로 두면 엑셀처럼 "DNA 는 줄었는데
 * 제품은 안 늘어난" 상태가 생긴다.
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
  const { productId, materialId, quantity, producedAt, note } = parsed.data

  const [product, material] = await Promise.all([
    prisma.crmProduct.findUnique({ where: { id: productId } }),
    prisma.crmProduct.findUnique({ where: { id: materialId } }),
  ])
  if (!product) return NextResponse.json({ error: "제품을 찾을 수 없습니다" }, { status: 404 })
  if (!material?.isMaterial) {
    return NextResponse.json({ error: "원료를 찾을 수 없습니다" }, { status: 404 })
  }

  // 그램을 안 보냈으면 용량·농도로 계산한다. 둘 다 없으면 계산할 근거가 없다.
  const grams =
    parsed.data.materialGrams ??
    gramsForQuantity(
      quantity,
      product.volumeMl ? Number(product.volumeMl) : null,
      product.concentrationPct ? Number(product.concentrationPct) : null
    )
  if (grams == null) {
    return NextResponse.json(
      {
        error: `${product.name} 은 용량(ml) 또는 농도(wt%)가 비어 있어 소요량을 계산할 수 없습니다. 쓴 그램을 직접 입력하거나 제품 정보를 채워 주세요`,
      },
      { status: 400 }
    )
  }

  const production = await createWithUniqueCode(() =>
    prisma.$transaction(async (tx) => {
      const codes = (await tx.crmProduction.findMany({ select: { code: true } })).map((p) => p.code)
      const created = await tx.crmProduction.create({
        data: {
          code: nextCode("MFG", codes),
          producedAt,
          quantity,
          materialGrams: grams,
          note: note ?? null,
          product: { connect: { id: productId } },
          material: { connect: { id: materialId } },
        },
      })
      await tx.crmStockMove.createMany({
        data: [
          {
            movedAt: producedAt,
            productId: materialId,
            direction: "OUT",
            quantity: grams,
            note: `생산 ${created.code}`,
            productionId: created.id,
          },
          {
            movedAt: producedAt,
            productId,
            direction: "IN",
            quantity,
            note: `생산 ${created.code}`,
            productionId: created.id,
          },
        ],
      })
      return created
    })
  )

  return NextResponse.json({ ...production, materialGrams: grams }, { status: 201 })
}
