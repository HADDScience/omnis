// 인증 한 줄 고치기 — 아카이브 › 인증 탭의 칸 하나씩(expect 로 충돌 확인) · 보드의 단계 옮기기.
// 구성원 누구나, 활동 기록에 남는다. 받는 칸: lib/grants.ts CertPatch
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { apiError, parseJson } from "@/lib/api"
import { updateCertification } from "@/lib/grants"

export const runtime = "nodejs"

const FIELDS = [
  "status",
  "stageReason",
  "name",
  "issuer",
  "note",
  "acquiredOn",
  "validUntil",
  "deadline",
  "ownerId",
  "checklist",
  "evidence",
  "expect",
] as const

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ certId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const { certId } = await params
  const body = ((await parseJson(req)) ?? {}) as Record<string, unknown>
  const patch = Object.fromEntries(FIELDS.filter((k) => k in body).map((k) => [k, body[k]]))
  const r = await updateCertification(session.user.id, certId, patch)
  if (!r.ok) return apiError(r.status, r.error)
  return NextResponse.json({ id: certId, changed: r.changed })
}
