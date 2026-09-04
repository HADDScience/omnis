import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { CrmQuoteStatus } from "@/generated/prisma"

export const runtime = "nodejs"

const patchSchema = z.object({
  status: z.enum(CrmQuoteStatus).optional(),
  /** 세금계산서 발행일. 지우려면 null 을 보낸다 */
  taxInvoicedAt: z.coerce.date().nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
})

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ quoteId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const { quoteId } = await params
  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "잘못된 입력" },
      { status: 400 }
    )
  }

  const before = await prisma.crmQuote.findUnique({ where: { id: quoteId } })
  if (!before) return NextResponse.json({ error: "견적을 찾을 수 없습니다" }, { status: 404 })

  // 완료로 옮기는데 세금계산서 날짜가 없으면 오늘로 채운다. 사람이 두 번 누르지 않게.
  // 이미 적힌 날짜는 건드리지 않는다 — 지난 기록을 덮어쓰면 안 된다.
  const data = { ...parsed.data }
  if (
    data.status === CrmQuoteStatus.DONE &&
    data.taxInvoicedAt === undefined &&
    !before.taxInvoicedAt
  ) {
    data.taxInvoicedAt = new Date()
  }

  const quote = await prisma.crmQuote.update({ where: { id: quoteId }, data })
  return NextResponse.json(quote)
}

/**
 * 견적을 지운다.
 *
 * 품목은 함께 사라진다(스키마의 onDelete: Cascade). 출고는 남고 이 견적과의
 * 연결만 끊긴다(SetNull) — 물건이 실제로 나갔다는 사실은 견적을 지운다고
 * 없던 일이 되지 않는다.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ quoteId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const { quoteId } = await params
  const quote = await prisma.crmQuote.findUnique({
    where: { id: quoteId },
    select: { code: true },
  })
  if (!quote) return NextResponse.json({ error: "견적을 찾을 수 없습니다" }, { status: 404 })

  await prisma.crmQuote.delete({ where: { id: quoteId } })
  return NextResponse.json({ ok: true, code: quote.code })
}
