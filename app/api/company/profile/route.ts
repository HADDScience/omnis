import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { apiError, parseJson } from "@/lib/api"
import { isAdminSession } from "@/lib/company-edit"
import { saveCompanyProfile } from "@/lib/company-ops"

export const runtime = "nodejs"

/**
 * 회사 기본정보를 고친다 — 관리자만. 지원서에 그대로 들어가는 값이라 AI 는 고치지 않는다.
 * 바뀐 칸 이름을 활동 기록에 남긴다 (값 자체는 남기지 않는다 — 기록이 두 번째 원본이 되지 않게).
 */
export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  if (!isAdminSession(session)) return apiError(403, "관리자만 회사 정보를 고칠 수 있습니다")

  // 규칙은 lib/company-ops.ts saveCompanyProfile(도구 update_company_profile 와 같다)
  const r = await saveCompanyProfile(session.user.id, await parseJson(req))
  if (!r.ok) return apiError(r.status, r.error)
  return NextResponse.json({ ok: true, changed: r.value.changed })
}
