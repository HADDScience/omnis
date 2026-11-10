import { NextResponse, type NextRequest } from "next/server"

import { apiError, parseJson } from "@/lib/api"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { isFeatureStatus } from "@/lib/feature-requests"

export const runtime = "nodejs"

/** 기능 요청 상태 바꾸기(새로 · 검토 · 완료). 관리자만 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  if ((session.user as { role?: string }).role !== "ADMIN") return apiError(403, "관리자만 바꿀 수 있습니다")
  const body = await parseJson<{ status?: unknown }>(req)
  if (!body || !isFeatureStatus(body.status)) return apiError(400, "status 는 NEW · REVIEW · DONE 중 하나입니다")
  const { id } = await params
  const updated = await prisma.featureRequest.updateMany({ where: { id }, data: { status: body.status } })
  if (updated.count === 0) return apiError(404, "없는 요청입니다")
  return NextResponse.json({ id, status: body.status })
}
