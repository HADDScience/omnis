import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { deleteQuote, updateQuote } from "@/lib/crm-ops"

export const runtime = "nodejs"

/** 견적 고치기(상태 · 발행일 · 비고). 완료 + 세금계산서 없음이면 재무 담당에게 알림 — lib/crm-ops.ts updateQuote */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ quoteId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const { quoteId } = await params
  const r = await updateQuote(quoteId, await req.json().catch(() => null), { id: session.user.id, name: session.user.name })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json(r.value)
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
  const r = await deleteQuote(quoteId)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true, code: r.value.code })
}
