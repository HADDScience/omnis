import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { apiError, parseJson } from "@/lib/api"
import { isAdminSession } from "@/lib/company-edit"
import { deleteCompanyYear, updateCompanyYear } from "@/lib/company-ops"

export const runtime = "nodejs"

interface Props {
  params: Promise<{ yearId: string }>
}

/** 연도별 재무 한 줄 고치기 · 지우기 — 관리자만. 규칙은 lib/company-ops.ts(도구 save_company_year · delete_company_year 와 같다) */
export async function PATCH(req: NextRequest, { params }: Props) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  if (!isAdminSession(session)) return apiError(403, "관리자만 재무를 고칠 수 있습니다")
  const { yearId } = await params
  const r = await updateCompanyYear(session.user.id, yearId, await parseJson(req))
  if (!r.ok) return apiError(r.status, r.error)
  return NextResponse.json({ ok: true, changed: r.value.changed })
}

export async function DELETE(_req: NextRequest, { params }: Props) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  if (!isAdminSession(session)) return apiError(403, "관리자만 재무를 고칠 수 있습니다")
  const { yearId } = await params
  const r = await deleteCompanyYear(session.user.id, yearId)
  if (!r.ok) return apiError(r.status, r.error)
  return NextResponse.json({ ok: true })
}
