import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { apiError } from "@/lib/api"
import { reattachAgentRun } from "@/lib/agent/service"
import { agentStream } from "@/lib/agent/http"

export const runtime = "nodejs"
export const maxDuration = 300

/** 새로고침 뒤 돌고 있는 실행에 다시 붙는다 — 처음부터 다시 받는다 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const { runId } = await params
  const r = await reattachAgentRun(runId, session.user.id)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return agentStream(r.stream, r.headers)
}
