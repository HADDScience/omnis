// 인증 한 줄 고치기 — 상태 · 메모 · 취득일 · 유효기간. 구성원 누구나, 활동 기록에 남는다.
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { apiError, parseJson } from "@/lib/api"
import { updateCertification } from "@/lib/grants"

export const runtime = "nodejs"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ certId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const { certId } = await params
  const body = ((await parseJson(req)) ?? {}) as Record<string, unknown>
  const r = await updateCertification(session.user.id, certId, {
    status: body.status,
    note: body.note,
    acquiredOn: body.acquiredOn,
    validUntil: body.validUntil,
  })
  if (!r.ok) return apiError(r.status, r.error)
  return NextResponse.json({ id: certId, changed: r.changed })
}
