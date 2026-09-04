import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { quoteCreateSchema, nextDatedCode, quoteTotals } from "@/lib/crm"
import { createWithUniqueCode } from "@/lib/crm-server"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const parsed = quoteCreateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "잘못된 입력" },
      { status: 400 }
    )
  }
  const { items, quotedAt, orgId, contactId, membershipId, ...rest } = parsed.data

  // 담당자가 그 기관 소속인지 확인한다. 엑셀은 이름 문자열이라 아무 조합이나 됐다.
  if (contactId) {
    const c = await prisma.crmContact.findUnique({ where: { id: contactId } })
    if (!c || c.orgId !== orgId) {
      return NextResponse.json({ error: "담당자가 이 기관 소속이 아닙니다" }, { status: 400 })
    }
  }

  const quote = await createWithUniqueCode(() =>
    prisma.$transaction(async (tx) => {
    const codes = (
      await tx.crmQuote.findMany({ select: { code: true } })
    ).map((q) => q.code)
    return tx.crmQuote.create({
      data: {
        ...rest,
        code: nextDatedCode(quotedAt, codes),
        quotedAt,
        org: { connect: { id: orgId } },
        contact: contactId ? { connect: { id: contactId } } : undefined,
        membership: membershipId ? { connect: { id: membershipId } } : undefined,
        items: {
          create: items.map((it, i) => ({
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            note: it.note ?? null,
            sortOrder: i,
            product: { connect: { id: it.productId } },
          })),
        },
      },
      include: { items: true },
    })
    })
  )

  // 응답에 계산 결과를 함께 준다 — 화면이 같은 식을 다시 짜지 않게.
  return NextResponse.json(
    { ...quote, totals: quoteTotals(quote.items, quote.discountAmount, quote.vatRate) },
    { status: 201 }
  )
}
