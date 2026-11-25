// 국가과제 결정 한 줄 고치기 — 단계 · 사유 · 메모 · 마감 · 담당자 · 업무/프로젝트 연결. 구성원 누구나, 활동 기록에 남는다.
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { apiError, parseJson } from "@/lib/api"
import { updateGrantDecision } from "@/lib/grants"

export const runtime = "nodejs"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ decisionId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const { decisionId } = await params
  const body = ((await parseJson(req)) ?? {}) as Record<string, unknown>
  const r = await updateGrantDecision(session.user.id, decisionId, {
    stage: body.stage,
    stageReason: body.stageReason,
    note: body.note,
    deadline: body.deadline,
    ownerIds: body.ownerIds,
    taskId: body.taskId,
    projectId: body.projectId,
  })
  if (!r.ok) return apiError(r.status, r.error)
  return NextResponse.json({ id: decisionId, changed: r.changed })
}
