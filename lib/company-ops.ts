// 회사 정보 · 연도별 재무 · 웍스 캘린더 공개 범위 — 화면(app/api/company/profile · years · calendar/calendars)과
// 도구(lib/tools/plan-admin.ts)가 같이 부른다(#248). 관리자 확인은 부르는 쪽(라우트 세션 · 도구 caller.role)이 한다.
import { prisma } from "@/lib/db"
import { writeActivity } from "@/lib/api"
import { CompanyProfileSchema, CompanyYearSchema, PROFILE_FIELD_LABEL, YEAR_MONEY_FIELDS, type CompanyProfileInput } from "@/lib/schemas/company"
import { isUniqueViolation, profileData, sameValue, yearData } from "@/lib/company-edit"
import { BASIS_LABEL } from "@/lib/company-context"

export type CompanyOpResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string }
const fail = (status: number, error: string) => ({ ok: false as const, status, error })

/** 회사 기본정보 저장(통째로) — 바뀐 칸을 활동 기록에 남긴다 */
export async function saveCompanyProfile(userId: string, input: unknown): Promise<CompanyOpResult<{ changed: string[] }>> {
  const parsed = CompanyProfileSchema.safeParse(input)
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "잘못된 입력")
  const data = { ...profileData(parsed.data), updatedById: userId }
  const before = await prisma.companyProfile.findUnique({ where: { id: "hadd" } })
  await prisma.companyProfile.upsert({ where: { id: "hadd" }, create: { id: "hadd", ...data }, update: data })
  const keys = Object.keys(PROFILE_FIELD_LABEL) as (keyof CompanyProfileInput)[]
  const changed = before ? keys.filter((k) => !sameValue(before[k], data[k])) : keys.filter((k) => data[k] !== null)
  await writeActivity({
    userId,
    action: before ? "company.profile.updated" : "company.profile.created",
    entity: "COMPANY_PROFILE",
    entityId: "hadd",
    title: `회사 정보 ${before ? "수정" : "입력"}: ${changed.map((k) => PROFILE_FIELD_LABEL[k]).join(", ") || "바뀐 칸 없음"}`,
    metadata: { changed },
  })
  return { ok: true, value: { changed } }
}

export const YEAR_FIELD_LABEL: Record<string, string> = {
  year: "연도",
  basis: "단계",
  ...Object.fromEntries(YEAR_MONEY_FIELDS),
  headcount: "상시근로자",
  accountLabel: "결산서 매출 계정",
  note: "비고",
  asOfDate: "기준일",
}

export async function createCompanyYear(userId: string, input: unknown): Promise<CompanyOpResult<{ id: string }>> {
  const parsed = CompanyYearSchema.safeParse(input)
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "잘못된 입력")
  try {
    const row = await prisma.companyYear.create({ data: yearData(parsed.data) })
    await writeActivity({ userId, action: "company.year.created", entity: "COMPANY_YEAR", entityId: row.id, title: `연도별 재무 추가: ${row.year} ${BASIS_LABEL[row.basis]}` })
    return { ok: true, value: { id: row.id } }
  } catch (err) {
    if (isUniqueViolation(err)) return fail(409, `${parsed.data.year}년 ${BASIS_LABEL[parsed.data.basis]} 줄이 이미 있습니다. 그 줄을 수정하세요`)
    throw err
  }
}

export async function updateCompanyYear(userId: string, yearId: string, input: unknown): Promise<CompanyOpResult<{ changed: string[] }>> {
  const before = await prisma.companyYear.findUnique({ where: { id: yearId } })
  if (!before) return fail(404, "없는 줄입니다")
  const parsed = CompanyYearSchema.safeParse(input)
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "잘못된 입력")
  const data = yearData(parsed.data)
  try {
    const row = await prisma.companyYear.update({ where: { id: yearId }, data })
    const changed = Object.keys(YEAR_FIELD_LABEL).filter((k) => !sameValue(before[k as keyof typeof before], data[k as keyof typeof data]))
    await writeActivity({
      userId, action: "company.year.updated", entity: "COMPANY_YEAR", entityId: row.id,
      title: `연도별 재무 수정: ${row.year} ${BASIS_LABEL[row.basis]} · ${changed.map((k) => YEAR_FIELD_LABEL[k]).join(", ") || "바뀐 칸 없음"}`,
      metadata: { changed },
    })
    return { ok: true, value: { changed } }
  } catch (err) {
    if (isUniqueViolation(err)) return fail(409, `${parsed.data.year}년 ${BASIS_LABEL[parsed.data.basis]} 줄이 이미 있습니다`)
    throw err
  }
}

export async function deleteCompanyYear(userId: string, yearId: string): Promise<CompanyOpResult<{ year: number }>> {
  const row = await prisma.companyYear.findUnique({ where: { id: yearId }, select: { id: true, year: true, basis: true, revenueKrw: true } })
  if (!row) return fail(404, "없는 줄입니다")
  await prisma.companyYear.delete({ where: { id: yearId } })
  await writeActivity({
    userId, action: "company.year.deleted", entity: "COMPANY_YEAR", entityId: row.id,
    title: `연도별 재무 삭제: ${row.year} ${BASIS_LABEL[row.basis]}`,
    metadata: { year: row.year, basis: row.basis, revenueKrw: row.revenueKrw === null ? null : row.revenueKrw.toString() },
  })
  return { ok: true, value: { year: row.year } }
}

/** 웍스 캘린더 공개 범위 — ALL(구성원 전체) · ADMIN(관리자만) */
export async function setCalendarAudience(userId: string, calendarId: string, audience: "ALL" | "ADMIN"): Promise<CompanyOpResult<{ id: string; displayName: string; audience: string }>> {
  const cal = await prisma.externalCalendar.findUnique({ where: { id: calendarId } })
  if (!cal) return fail(404, "캘린더를 찾지 못했습니다")
  const updated = await prisma.externalCalendar.update({ where: { id: calendarId }, data: { audience }, select: { id: true, displayName: true, audience: true } })
  await writeActivity({ userId, action: "calendar.audience", entity: "ExternalCalendar", entityId: calendarId, title: `${cal.displayName} — ${audience === "ALL" ? "구성원 전체 공개" : "관리자만"}` })
  return { ok: true, value: updated }
}
