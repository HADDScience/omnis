import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { apiError, parseJson, writeActivity } from "@/lib/api"
import { CompanyYearSchema, YEAR_MONEY_FIELDS } from "@/lib/schemas/company"
import { isAdminSession, isUniqueViolation, sameValue, yearData } from "@/lib/company-edit"
import { BASIS_LABEL } from "@/lib/company-context"

export const runtime = "nodejs"

interface Props {
  params: Promise<{ yearId: string }>
}

const FIELD_LABEL: Record<string, string> = {
  year: "연도",
  basis: "단계",
  ...Object.fromEntries(YEAR_MONEY_FIELDS),
  headcount: "상시근로자",
  accountLabel: "결산서 매출 계정",
  note: "비고",
  asOfDate: "기준일",
}

/** 연도별 재무 한 줄을 고친다 — 관리자만 */
export async function PATCH(req: NextRequest, { params }: Props) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  if (!isAdminSession(session)) return apiError(403, "관리자만 재무를 고칠 수 있습니다")

  const { yearId } = await params
  const before = await prisma.companyYear.findUnique({ where: { id: yearId } })
  if (!before) return apiError(404, "없는 줄입니다")

  const parsed = CompanyYearSchema.safeParse(await parseJson(req))
  if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "잘못된 입력")
  const data = yearData(parsed.data)

  try {
    const row = await prisma.companyYear.update({ where: { id: yearId }, data })
    const changed = Object.keys(FIELD_LABEL).filter((k) => !sameValue(before[k as keyof typeof before], data[k as keyof typeof data]))
    await writeActivity({
      userId: session.user.id,
      action: "company.year.updated",
      entity: "COMPANY_YEAR",
      entityId: row.id,
      title: `연도별 재무 수정: ${row.year} ${BASIS_LABEL[row.basis]} · ${changed.map((k) => FIELD_LABEL[k]).join(", ") || "바뀐 칸 없음"}`,
      metadata: { changed },
    })
    return NextResponse.json({ ok: true, changed })
  } catch (err) {
    if (isUniqueViolation(err)) {
      return apiError(409, `${parsed.data.year}년 ${BASIS_LABEL[parsed.data.basis]} 줄이 이미 있습니다`)
    }
    throw err
  }
}

/** 연도별 재무 한 줄을 지운다 — 관리자만. 무엇을 지웠는지 활동 기록에 남긴다 */
export async function DELETE(_req: NextRequest, { params }: Props) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  if (!isAdminSession(session)) return apiError(403, "관리자만 재무를 고칠 수 있습니다")

  const { yearId } = await params
  const row = await prisma.companyYear.findUnique({ where: { id: yearId }, select: { id: true, year: true, basis: true, revenueKrw: true } })
  if (!row) return apiError(404, "없는 줄입니다")

  await prisma.companyYear.delete({ where: { id: yearId } })
  await writeActivity({
    userId: session.user.id,
    action: "company.year.deleted",
    entity: "COMPANY_YEAR",
    entityId: row.id,
    title: `연도별 재무 삭제: ${row.year} ${BASIS_LABEL[row.basis]}`,
    metadata: { year: row.year, basis: row.basis, revenueKrw: row.revenueKrw === null ? null : row.revenueKrw.toString() },
  })
  return NextResponse.json({ ok: true })
}
