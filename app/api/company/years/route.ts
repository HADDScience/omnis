import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { apiError, parseJson, writeActivity } from "@/lib/api"
import { CompanyYearSchema } from "@/lib/schemas/company"
import { isAdminSession, isUniqueViolation, yearData } from "@/lib/company-edit"
import { BASIS_LABEL } from "@/lib/company-context"

export const runtime = "nodejs"

/** 연도별 재무 한 줄을 더한다 — 관리자만. (연도, 단계) 는 하나뿐이다. 잠정은 저장하지 않는다(세금계산서에서 센다) */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  if (!isAdminSession(session)) return apiError(403, "관리자만 재무를 고칠 수 있습니다")

  const parsed = CompanyYearSchema.safeParse(await parseJson(req))
  if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "잘못된 입력")

  try {
    const row = await prisma.companyYear.create({ data: yearData(parsed.data) })
    await writeActivity({
      userId: session.user.id,
      action: "company.year.created",
      entity: "COMPANY_YEAR",
      entityId: row.id,
      title: `연도별 재무 추가: ${row.year} ${BASIS_LABEL[row.basis]}`,
    })
    return NextResponse.json({ ok: true, id: row.id }, { status: 201 })
  } catch (err) {
    if (isUniqueViolation(err)) {
      return apiError(409, `${parsed.data.year}년 ${BASIS_LABEL[parsed.data.basis]} 줄이 이미 있습니다. 그 줄을 수정하세요`)
    }
    throw err
  }
}
