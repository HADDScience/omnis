import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { apiError, parseJson } from "@/lib/api"
import { AgentTurnSchema } from "@/lib/schemas/agent"
import { loadAgentRoom, startAgentTurn } from "@/lib/agent/service"
import { agentDisabled, agentStream } from "@/lib/agent/http"

export const runtime = "nodejs"
export const maxDuration = 300

/** 방 화면 상태 — 글 · 확인 카드 · 돌고 있는 실행 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const { roomId } = await params
  const state = await loadAgentRoom(roomId, session.user.id)
  if (!state) return apiError(404, "대화를 찾을 수 없습니다")
  return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } })
}

/** 묻기 — { content } 새 글, { retryOf } 답을 못 받은 내 글. 답은 스트림 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const off = agentDisabled()
  if (off) return off
  const body = await parseJson(req)
  if (!body) return apiError(400, "잘못된 JSON 요청")
  const parsed = AgentTurnSchema.safeParse(body)
  if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다")

  const { roomId } = await params
  const r = await startAgentTurn({ roomId, userId: session.user.id, ...parsed.data })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return agentStream(r.stream, r.headers)
}
