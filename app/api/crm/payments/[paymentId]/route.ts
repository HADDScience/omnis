import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { writeActivity } from "@/lib/api"

export const runtime = "nodejs"

/** 잘못 적은 입금 한 줄을 지운다 — 누가 지웠는지 활동 기록에 남는다 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  const { paymentId } = await params
  const p = await prisma.crmPayment.findUnique({ where: { id: paymentId }, include: { invoice: { select: { buyerName: true, supplierName: true, direction: true } } } })
  if (!p) return NextResponse.json({ error: "없는 기록입니다" }, { status: 404 })
  await prisma.crmPayment.delete({ where: { id: paymentId } })
  await writeActivity({
    userId: session.user.id,
    action: "crm.payment.deleted",
    entity: "TAX_INVOICE",
    entityId: p.invoiceId,
    title: `입금 기록 삭제: ${p.invoice.direction === "SALE" ? p.invoice.buyerName : p.invoice.supplierName} ${Number(p.amountKrw).toLocaleString("ko-KR")}원`,
    metadata: { paidOn: p.paidOn.toISOString().slice(0, 10) },
  })
  return NextResponse.json({ ok: true })
}
