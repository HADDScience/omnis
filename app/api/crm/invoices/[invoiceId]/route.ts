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

/**
 * 세금계산서를 지운다 (2026-10-29). 잘못 올렸거나, 취소 뒤 일반 세금계산서로 새로 발행한 경우다.
 *
 * 수정세금계산서는 여기로 오지 않는 게 맞다 — 당초 장을 두고 취소(−) · 재발행(+) 을 올리면 묶인다.
 * 그걸 가르치는 건 지우기 창이 한다(components/crm/invoice-delete-button).
 *
 * NAS 원본 PDF 는 지우지 않는다 — 증빙이고 공용 저장소다. 입금 기록은 스키마대로 함께 지워진다.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ invoiceId: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  const { invoiceId } = await params

  const inv = await prisma.taxInvoice.findUnique({
    where: { id: invoiceId },
    select: {
      approvalNo: true, direction: true, issuedOn: true, buyerName: true, supplierName: true, totalKrw: true, quoteId: true, objectKey: true,
      _count: { select: { payments: true } },
    },
  })
  if (!inv) return NextResponse.json({ error: "세금계산서를 찾을 수 없습니다" }, { status: 404 })

  await prisma.$transaction(async (tx) => {
    await tx.taxInvoice.delete({ where: { id: invoiceId } })
    // 견적의 「세금계산서 발행」 표시는 그 견적에 남은 세금계산서가 없을 때만 푼다
    if (inv.quoteId && !(await tx.taxInvoice.count({ where: { quoteId: inv.quoteId } }))) {
      await tx.crmQuote.update({ where: { id: inv.quoteId }, data: { taxInvoicedAt: null } })
    }
  })

  const counter = inv.direction === "SALE" ? inv.buyerName : inv.supplierName
  await writeActivity({
    userId: session.user.id,
    action: "crm.invoice.deleted",
    entity: "TAX_INVOICE",
    entityId: invoiceId,
    title: `세금계산서 삭제: ${counter} ${Number(inv.totalKrw).toLocaleString("ko-KR")}원`,
    metadata: { approvalNo: inv.approvalNo, issuedOn: inv.issuedOn.toISOString().slice(0, 10), payments: inv._count.payments, objectKey: inv.objectKey },
  })
  return NextResponse.json({ ok: true, payments: inv._count.payments })
}
