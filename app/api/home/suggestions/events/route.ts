import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { recordSuggestionEvent } from "@/lib/home-suggestions/server"

const Body = z.object({ runId: z.string().min(1).max(64), itemKey: z.string().min(1).max(200), kind: z.enum(["impression", "click"]) })

// 제안 카드 노출 · 클릭 — trigger 별 클릭률 비교용(scripts/home-suggestions-report.ts)
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "runId · itemKey · kind 가 필요합니다" }, { status: 400 })
  const ok = await recordSuggestionEvent(session.user.id, parsed.data)
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 })
}
