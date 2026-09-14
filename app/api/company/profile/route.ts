import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { apiError, parseJson, writeActivity } from "@/lib/api"
import { CompanyProfileSchema, PROFILE_FIELD_LABEL, type CompanyProfileInput } from "@/lib/schemas/company"
import { isAdminSession, profileData, sameValue } from "@/lib/company-edit"

export const runtime = "nodejs"

/**
 * 회사 기본정보를 고친다 — 관리자만. 지원서에 그대로 들어가는 값이라 AI 는 고치지 않는다.
 * 바뀐 칸 이름을 활동 기록에 남긴다 (값 자체는 남기지 않는다 — 기록이 두 번째 원본이 되지 않게).
 */
export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  if (!isAdminSession(session)) return apiError(403, "관리자만 회사 정보를 고칠 수 있습니다")

  const parsed = CompanyProfileSchema.safeParse(await parseJson(req))
  if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "잘못된 입력")

  const data = { ...profileData(parsed.data), updatedById: session.user.id }
  const before = await prisma.companyProfile.findUnique({ where: { id: "hadd" } })
  await prisma.companyProfile.upsert({ where: { id: "hadd" }, create: { id: "hadd", ...data }, update: data })

  const keys = Object.keys(PROFILE_FIELD_LABEL) as (keyof CompanyProfileInput)[]
  const changed = before ? keys.filter((k) => !sameValue(before[k], data[k])) : keys.filter((k) => data[k] !== null)
  await writeActivity({
    userId: session.user.id,
    action: before ? "company.profile.updated" : "company.profile.created",
    entity: "COMPANY_PROFILE",
    entityId: "hadd",
    title: `회사 정보 ${before ? "수정" : "입력"}: ${changed.map((k) => PROFILE_FIELD_LABEL[k]).join(", ") || "바뀐 칸 없음"}`,
    metadata: { changed },
  })
  return NextResponse.json({ ok: true, changed })
}
