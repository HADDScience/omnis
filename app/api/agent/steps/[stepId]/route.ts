import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { apiError, parseJson } from "@/lib/api"
import { DecideAgentStepSchema } from "@/lib/schemas/agent"
import { decideAgentStep } from "@/lib/agent/service"
import { agentDisabled, agentStream } from "@/lib/agent/http"

export const runtime = "nodejs"
export const maxDuration = 300

/**
 * 확인 카드 [확인] · [취소]. 이 구간의 마지막 카드면 같은 실행을 이어 가며 스트림을 돌려준다(x-agent-card-id 헤더),
 * 아직 기다리는 카드가 있으면 JSON { card }.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ stepId: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const off = agentDisabled()
  if (off) return off
  const body = await parseJson(req)
  if (!body) return apiError(400, "잘못된 JSON 요청")
  const parsed = DecideAgentStepSchema.safeParse(body)
  if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다")

  const { stepId } = await params
  const r = await decideAgentStep({ stepId, userId: session.user.id, ...parsed.data })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  if (r.continued) return agentStream(r.continued.stream, { ...r.continued.headers, "x-agent-card-id": r.card.id })
  return NextResponse.json({ card: r.card })
}
