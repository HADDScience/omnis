import { NextResponse, type NextRequest } from "next/server"

import { apiError, parseJson, writeActivity } from "@/lib/api"
import { auth } from "@/lib/auth"
import { FEATURE_STATUS_LABEL, changeFeatureStatus, isFeatureStatus, parseDoneNotice, type DoneNotice } from "@/lib/feature-requests"

export const runtime = "nodejs"

/**
 * 기능 요청 상태 바꾸기(새로 · 검토 · 완료). 관리자만.
 * 완료로 바꿀 때 notice({ change, link })를 주면 요청한 사람에게 「생겼습니다」 알림이 간다(lib/feature-requests.ts changeFeatureStatus).
 * notice 가 없으면 예전처럼 상태만 바꾼다.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  if ((session.user as { role?: string }).role !== "ADMIN") return apiError(403, "관리자만 바꿀 수 있습니다")
  const body = await parseJson<{ status?: unknown; notice?: unknown }>(req)
  if (!body || !isFeatureStatus(body.status)) return apiError(400, "status 는 NEW · REVIEW · DONE 중 하나입니다")

  let notice: DoneNotice | null = null
  if (body.notice != null) {
    if (body.status !== "DONE") return apiError(400, "알림은 완료로 바꿀 때만 보냅니다")
    const parsed = parseDoneNotice(body.notice)
    if ("problem" in parsed) return apiError(400, parsed.problem)
    notice = parsed
  }

  const { id } = await params
  const r = await changeFeatureStatus(id, body.status, session.user.id, notice)
  if (!r.found) return apiError(404, "없는 요청입니다")
  // 관리자 행동 감사 기록(/admin/audit)
  await writeActivity({
    userId: session.user.id,
    action: "feature_request.status",
    entity: "admin", // 요청 제목이 실려 있어 공개 활동 기록에 내보내지 않는다(PRIVATE_ACTIVITY_ENTITIES)
    entityId: id,
    title: `기능 요청 「${r.title}」 → ${FEATURE_STATUS_LABEL[body.status]}${notice ? ` · 요청한 사람 ${r.notified}명에게 알림` : ""}`,
  })
  return NextResponse.json({ id, status: body.status, notified: r.notified })
}
