import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { deletePayment } from "@/lib/crm-ops"

export const runtime = "nodejs"

/** 잘못 적은 입금 한 줄을 지운다 — 누가 지웠는지 활동 기록에 남는다(lib/crm-ops.ts deletePayment, 도구 delete_payment 와 같다) */
export async function DELETE(_req: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  const { paymentId } = await params
  const r = await deletePayment(paymentId, session.user.id)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true })
}
