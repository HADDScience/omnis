import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { writeActivity } from "@/lib/api"
import { receivableChains } from "@/lib/crm-receivables"

export const runtime = "nodejs"

const schema = z.object({
  invoiceId: z.string().min(1),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "날짜는 YYYY-MM-DD"),
  amountKrw: z.coerce.number().int("금액은 원 단위 정수").positive("금액은 0보다 커야 합니다"),
  note: z.string().trim().max(200).optional().nullable(),
})

/** 들어온 돈 · 나간 돈 한 줄. 나눠 들어오면 여러 번 적는다 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "잘못된 입력" }, { status: 400 })
  const { invoiceId, paidOn, amountKrw, note } = parsed.data

  const invoice = await prisma.taxInvoice.findUnique({ where: { id: invoiceId }, select: { id: true, direction: true, approvalNo: true, originalApprovalNo: true, buyerName: true, supplierName: true } })
  if (!invoice) return NextResponse.json({ error: "세금계산서를 찾을 수 없습니다" }, { status: 404 })

  // 묶음(수정세금계산서 포함) 기준으로 남은 금액을 넘지 않게 — 두 번 적는 실수를 막는다
  const root = invoice.originalApprovalNo ?? invoice.approvalNo
  const chain = (await receivableChains(invoice.direction)).find((c) => c.approvalNo === root || c.invoiceId === invoiceId)
  if (chain && amountKrw > chain.remaining) {
    return NextResponse.json({ error: `남은 금액(${chain.remaining.toLocaleString("ko-KR")}원)보다 많습니다` }, { status: 409 })
  }

  const payment = await prisma.crmPayment.create({
    data: { invoiceId, paidOn: new Date(`${paidOn}T00:00:00Z`), amountKrw: BigInt(amountKrw), note: note || null, createdById: session.user.id },
  })
  const who = invoice.direction === "SALE" ? invoice.buyerName : invoice.supplierName
  await writeActivity({
    userId: session.user.id,
    action: invoice.direction === "SALE" ? "crm.payment.received" : "crm.payment.paid",
    entity: "TAX_INVOICE",
    entityId: invoiceId,
    title: `${invoice.direction === "SALE" ? "입금" : "지급"}: ${who} ${amountKrw.toLocaleString("ko-KR")}원 (${paidOn})`,
    metadata: { paymentId: payment.id, amountKrw },
  })
  return NextResponse.json({ id: payment.id, remaining: chain ? chain.remaining - amountKrw : null }, { status: 201 })
}
