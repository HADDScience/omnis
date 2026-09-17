import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { writeActivity } from "@/lib/api"

export const runtime = "nodejs"

const schema = z.object({ quoteId: z.string().min(1).nullable() })

/**
 * 세금계산서를 견적에 잇거나 끊는다 (2026-09-17).
 *
 * 자동으로 못 잇는 흔한 경우가 있다 — 대학은 견적은 학과로, 세금계산서는 산학협력단으로 나간다.
 * 기관이 달라 합계 · 날짜가 맞아도 이어지지 않는다. 견적 화면에서 사람이 한 번 눌러 잇는다.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ invoiceId: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  const { invoiceId } = await params
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "잘못된 입력" }, { status: 400 })

  const inv = await prisma.taxInvoice.findUnique({ where: { id: invoiceId }, select: { id: true, issuedOn: true, buyerName: true, direction: true } })
  if (!inv) return NextResponse.json({ error: "세금계산서를 찾을 수 없습니다" }, { status: 404 })
  if (inv.direction !== "SALE" && parsed.data.quoteId) return NextResponse.json({ error: "매입 세금계산서는 견적에 잇지 않습니다" }, { status: 400 })

  const quote = parsed.data.quoteId ? await prisma.crmQuote.findUnique({ where: { id: parsed.data.quoteId }, select: { id: true, code: true } }) : null
  if (parsed.data.quoteId && !quote) return NextResponse.json({ error: "견적을 찾을 수 없습니다" }, { status: 404 })

  await prisma.taxInvoice.update({ where: { id: invoiceId }, data: { quoteId: quote?.id ?? null } })
  if (quote) await prisma.crmQuote.updateMany({ where: { id: quote.id, taxInvoicedAt: null }, data: { taxInvoicedAt: inv.issuedOn } })
  await writeActivity({
    userId: session.user.id,
    action: "crm.invoice.linked",
    entity: "TAX_INVOICE",
    entityId: invoiceId,
    title: quote ? `세금계산서 ↔ 견적 잇기: ${inv.buyerName} · ${quote.code}` : `세금계산서 견적 연결 끊기: ${inv.buyerName}`,
  })
  return NextResponse.json({ ok: true })
}
