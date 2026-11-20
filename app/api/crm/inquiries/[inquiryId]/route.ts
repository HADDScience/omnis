import { NextResponse } from "next/server"

import { auth } from "@/lib/auth"
import { acceptInquiry, rejectInquiry } from "@/lib/crm-ops"

export const runtime = "nodejs"

/**
 * 홈페이지 문의 검토 — 승인 · 반려 · 스팸.
 *
 * 승인만이 CRM 을 만든다. 반려·스팸은 문의의 상태만 바꾸고 기관 목록을 건드리지 않는다 —
 * 그것이 문의함을 CRM 밖에 둔 이유다. 규칙은 lib/crm-ops.ts acceptInquiry · rejectInquiry(도구 decide_inquiry 와 같다).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ inquiryId: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  const { inquiryId } = await params

  const body = (await req.json().catch(() => null)) as { action?: string } | null
  if (body?.action === "reject") {
    const r = await rejectInquiry(inquiryId, session.user.id, body)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
    return NextResponse.json({ ok: true, status: r.value.status })
  }
  if (body?.action === "accept") {
    const r = await acceptInquiry(inquiryId, session.user.id, body)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
    return NextResponse.json({ ok: true, ...r.value }, { status: 201 })
  }
  return NextResponse.json({ error: "action 은 accept 또는 reject 입니다" }, { status: 400 })
}
