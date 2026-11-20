import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { apiError, parseJson } from "@/lib/api"
import { isAdminSession } from "@/lib/company-edit"
import { createCompanyYear } from "@/lib/company-ops"

export const runtime = "nodejs"

/** 연도별 재무 한 줄을 더한다 — 관리자만. (연도, 단계) 는 하나뿐이다. 잠정은 저장하지 않는다(세금계산서에서 센다) */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  if (!isAdminSession(session)) return apiError(403, "관리자만 재무를 고칠 수 있습니다")

  const r = await createCompanyYear(session.user.id, await parseJson(req))
  if (!r.ok) return apiError(r.status, r.error)
  return NextResponse.json({ ok: true, id: r.value.id }, { status: 201 })
}
