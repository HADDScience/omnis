import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { apiError } from "@/lib/api"
import { stopAgentRun } from "@/lib/agent/service"

export const runtime = "nodejs"
export const maxDuration = 30

/**
 * 「답변 중지」 — 답하는 중인(RUNNING) 내 실행을 멈춘다. 이미 끝났으면 409(화면은 방을 다시 읽기만 한다).
 * 모델 키 · 승인 비밀이 없어도 받는다 — 멈추는 일은 막지 않는다
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const { runId } = await params
  const r = await stopAgentRun(runId, session.user.id)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ status: r.status })
}
