import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { CrmQuoteStatus } from "@/generated/prisma"
import { createNotification } from "@/lib/notifications"

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

  // 완료로 옮길 때 세금계산서 발행일을 오늘로 채우던 것을 멈춘다(2026-09-17).
  // 세금계산서가 없어도 「발행」 으로 보여서 재무 담당에게 틀린 정보였다 — 운영 견적 13건 중 5건이
  // 연결된 세금계산서 없이 발행일만 찍혀 있었다. 발행일은 세금계산서가 이어질 때만 적힌다(lib/tax-invoice-save).
  const data = { ...parsed.data }

  const quote = await prisma.crmQuote.update({
    where: { id: quoteId },
    data,
    include: { org: { select: { name: true } }, _count: { select: { taxInvoices: true } } },
  })

  // 완료가 됐는데 세금계산서가 없으면 재무 담당에게 발행을 부탁한다.
  // 담당자가 메신저로 전하던 일이다 — 알림을 누르면 이 견적이 잡힌 채 세금계산서 등록이 열린다.
  if (data.status === CrmQuoteStatus.DONE && before.status !== CrmQuoteStatus.DONE && quote._count.taxInvoices === 0) {
    const finance = await prisma.user.findMany({
      where: { isActive: true, department: { contains: "재무" }, id: { not: session.user.id } },
      select: { id: true },
    })
    for (const u of finance) {
      await createNotification(
        u.id,
        "crm_invoice_request",
        `세금계산서 발행 요청: ${quote.org.name}`,
        `${session.user.name ?? "담당자"}님이 견적 ${quote.code} 를 완료했습니다. 세금계산서를 발행해 올려 주세요.`,
        quote.id
      )
    }
  }

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
