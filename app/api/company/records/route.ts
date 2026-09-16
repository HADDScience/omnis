// 연혁 한 줄을 새로 만든다 — 관리자만.
//
// 그 전에는 이 표에 쓰는 길이 이식 스크립트뿐이었다(2026-09-16). 사건이 생길 때마다
// 사람이 바로 남길 수 있어야 연혁이 낡지 않는다.
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { apiError, parseJson, writeActivity } from "@/lib/api"
import { CompanyRecordSchema } from "@/lib/schemas/company"
import { isUniqueViolation, recordData, recordDedupeKey } from "@/lib/company-edit"
import { RECORD_KIND_LABEL } from "@/lib/company-context"

export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  const session = await auth()
  // 구성원이면 누구나 남긴다(2026-09-16) — 사건을 겪은 사람이 그 자리에서 적어야 연혁이 낡지 않는다.
  // 관리자만 열어 두면 결국 한 사람에게 몰리고, 나중에 메일·엑셀을 뒤져 복원하게 된다.
  if (!session?.user?.id) return apiError(401, "인증 필요")

  const parsed = CompanyRecordSchema.safeParse(await parseJson(req))
  if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "잘못된 입력")

  const data = recordData(parsed.data)
  const dedupeKey = recordDedupeKey({
    kind: data.kind,
    title: data.title,
    organizer: data.organizer,
    partner: data.partner,
    startsOn: parsed.data.startsOn,
    periodRaw: data.periodRaw,
  })

  try {
    // 출처는 「옴니스」 — 엑셀 이식본과 화면에서 남긴 것을 나중에 가릴 수 있게
    const row = await prisma.companyRecord.create({ data: { dedupeKey, source: "옴니스", ...data } })
    await writeActivity({
      userId: session.user.id,
      action: "company.record.created",
      entity: "COMPANY_RECORD",
      entityId: row.id,
      title: `연혁 추가: [${RECORD_KIND_LABEL[row.kind]}] ${row.title}`,
      metadata: { kind: row.kind, startsOn: parsed.data.startsOn },
    })
    return NextResponse.json({ id: row.id }, { status: 201 })
  } catch (err) {
    // 같은 사건을 두 번 남기는 것을 막는다 — 종류 · 제목 · 주관 · 날짜가 같으면 한 줄이다
    if (isUniqueViolation(err)) return apiError(409, "같은 연혁이 이미 있습니다")
    throw err
  }
}
