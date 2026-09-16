// 연혁 한 줄을 고치고 지운다 — 관리자만.
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { apiError, parseJson, writeActivity } from "@/lib/api"
import { CompanyRecordSchema, RECORD_FIELD_LABEL } from "@/lib/schemas/company"
import { isUniqueViolation, recordData, recordDedupeKey, sameValue } from "@/lib/company-edit"
import { RECORD_KIND_LABEL } from "@/lib/company-context"

export const runtime = "nodejs"

interface Props {
  params: Promise<{ recordId: string }>
}

export async function PATCH(req: NextRequest, { params }: Props) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")

  const { recordId } = await params
  const before = await prisma.companyRecord.findUnique({ where: { id: recordId } })
  if (!before) return apiError(404, "없는 줄입니다")

  const parsed = CompanyRecordSchema.safeParse(await parseJson(req))
  if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "잘못된 입력")

  const data = recordData(parsed.data)
  // 제목 · 날짜가 바뀌면 멱등 키도 따라 바뀐다. 그러지 않으면 다음 이식이 옛 키로 이 줄을 덮는다.
  const dedupeKey = recordDedupeKey({
    kind: data.kind,
    title: data.title,
    organizer: data.organizer,
    partner: data.partner,
    startsOn: parsed.data.startsOn,
    periodRaw: data.periodRaw,
  })

  try {
    const row = await prisma.companyRecord.update({ where: { id: recordId }, data: { dedupeKey, ...data } })
    const changed = (Object.keys(RECORD_FIELD_LABEL) as (keyof typeof RECORD_FIELD_LABEL)[])
      .filter((k) => !sameValue(before[k as keyof typeof before], data[k as keyof typeof data]))
      .map((k) => RECORD_FIELD_LABEL[k])
    await writeActivity({
      userId: session.user.id,
      action: "company.record.updated",
      entity: "COMPANY_RECORD",
      entityId: row.id,
      title: `연혁 수정: [${RECORD_KIND_LABEL[row.kind]}] ${row.title}`,
      metadata: { changed },
    })
    return NextResponse.json({ id: row.id, changed })
  } catch (err) {
    if (isUniqueViolation(err)) return apiError(409, "고친 내용이 다른 연혁과 같습니다")
    throw err
  }
}

export async function DELETE(_req: NextRequest, { params }: Props) {
  const session = await auth()
  // 지우는 것도 구성원 전체에게 연다(작업지시자 결정 2026-09-16). 누가 지웠는지는 활동 기록에 남는다.
  if (!session?.user?.id) return apiError(401, "인증 필요")

  const { recordId } = await params
  const row = await prisma.companyRecord.findUnique({ where: { id: recordId } })
  if (!row) return apiError(404, "없는 줄입니다")

  // 연혁은 행을 지운다 — 채팅과 달리 가리키는 것도 색인도 없다.
  await prisma.companyRecord.delete({ where: { id: recordId } })
  await writeActivity({
    userId: session.user.id,
    action: "company.record.deleted",
    entity: "COMPANY_RECORD",
    entityId: recordId,
    title: `연혁 삭제: [${RECORD_KIND_LABEL[row.kind]}] ${row.title}`,
    metadata: { startsOn: row.startsOn?.toISOString().slice(0, 10) ?? null },
  })
  return NextResponse.json({ ok: true })
}
