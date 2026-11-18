import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createQuote } from "@/lib/crm-ops"

export const runtime = "nodejs"

/** 견적 만들기 — 규칙(담당자 소속 확인 · 코드 · 합계)은 lib/crm-ops.ts createQuote(AI 도구 create_quote 와 같다) */
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const r = await createQuote(await req.json().catch(() => null))
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json(r.value, { status: 201 })
}
