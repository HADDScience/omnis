import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createPayment } from "@/lib/crm-ops"

export const runtime = "nodejs"

/** 들어온 돈 · 나간 돈 한 줄. 남은 금액 검사 · 활동 기록은 lib/crm-ops.ts createPayment(AI 도구 record_payment 와 같다) */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const r = await createPayment(await req.json().catch(() => null), session.user.id)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json(r.value, { status: 201 })
}
