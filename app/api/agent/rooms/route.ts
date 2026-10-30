import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { apiError, parseJson } from "@/lib/api"
import { StartAgentRoomSchema } from "@/lib/schemas/agent"
import { startAgentRoom } from "@/lib/agent/service"
import { agentDisabled, agentStream } from "@/lib/agent/http"

export const runtime = "nodejs"
export const maxDuration = 300

/** 새 대화 — 방을 만들고 첫 글(+ 첨부 fileIds)로 에이전트를 연다. 답은 스트림(UI message stream)으로, 방 id 는 x-room-id 헤더 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const off = agentDisabled()
  if (off) return off
  const body = await parseJson(req)
  if (!body) return apiError(400, "잘못된 JSON 요청")
  const parsed = StartAgentRoomSchema.safeParse(body)
  if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다")

  const r = await startAgentRoom(session.user.id, parsed.data.content, parsed.data.fileIds)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return agentStream(r.stream, r.headers)
}
