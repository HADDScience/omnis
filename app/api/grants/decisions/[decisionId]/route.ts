// 국가과제 결정 고치기(PATCH) — 단계 · 사유 · 메모 · 지원금액 · 상태별 칸 · 마감 · 담당자 · 업무/프로젝트 · NAS 폴더 연결.
// 화면은 칸 하나씩 보내고 expect(고치기 전에 본 값)를 붙인다 — 그새 바뀌었으면 409.
// 내리기(DELETE) — 과제 후보에서 올린 결정만. 노션에서 옮겨 온 결정은 409(중단으로 바꾼다). 둘 다 구성원 누구나, 활동 기록에 남는다.
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { apiError, parseJson } from "@/lib/api"
import { removeGrantDecision, updateGrantDecision } from "@/lib/grants"

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
    nasFolder: body.nasFolder,
    taskId: body.taskId,
    projectId: body.projectId,
    amount: body.amount,
    selectedOn: body.selectedOn,
    awardedAmount: body.awardedAmount,
    agreementOn: body.agreementOn,
    startsOn: body.startsOn,
    endsOn: body.endsOn,
    completedOn: body.completedOn,
    expect: body.expect,
  })
  if (!r.ok) return apiError(r.status, r.error)
  return NextResponse.json({ id: decisionId, changed: r.changed })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ decisionId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const { decisionId } = await params
  const r = await removeGrantDecision(session.user.id, decisionId)
  if (!r.ok) return apiError(r.status, r.error)
  return NextResponse.json({ id: decisionId, removed: true })
}
