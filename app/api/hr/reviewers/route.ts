import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/db"
import { parseJson, writeActivity } from "@/lib/api"
import { requireAdminApi } from "@/lib/admin-access-server"
import { ACTIVE_MEMBER_WHERE, newlyChosen } from "@/lib/active-members"
import { configuredReviewerIds, saveReviewerIds } from "@/lib/hr/reviewers"

/**
 * 채용 담당(지원서를 볼 사람) — 관리자만 보고 고친다. 바꿀 때마다 활동 기록에 남긴다.
 * AI 도구로 열지 않는다: 개인정보를 누가 볼지 정하는 일이라 사람이 화면에서 한다(lib/tools/route-coverage.ts HRACCESS).
 */
export async function GET() {
  const gate = await requireAdminApi()
  if ("fail" in gate) return gate.fail
  return NextResponse.json({ userIds: await configuredReviewerIds() })
}

const Body = z.object({ userIds: z.array(z.string().uuid()).max(20) })

export async function PUT(req: NextRequest) {
  const gate = await requireAdminApi()
  if ("fail" in gate) return gate.fail
  const parsed = Body.safeParse(await parseJson(req))
  if (!parsed.success) return NextResponse.json({ error: "userIds 는 계정 ID 목록입니다" }, { status: 400 })

  const previous = await configuredReviewerIds()
  const next = [...new Set(parsed.data.userIds)]
  const added = newlyChosen(next, previous)
  if (added.length) {
    const ok = await prisma.user.count({ where: { id: { in: added }, ...ACTIVE_MEMBER_WHERE } })
    if (ok !== added.length) return NextResponse.json({ error: "재직 중인 구성원만 채용 담당으로 고를 수 있습니다" }, { status: 400 })
  }
  await saveReviewerIds(next, gate.userId)
  const names = new Map((await prisma.user.findMany({ where: { id: { in: [...next, ...previous] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]))
  await writeActivity({
    userId: gate.userId,
    action: "hr.reviewers.changed",
    entity: "hr_reviewers",
    title: `채용 담당: ${next.map((id) => names.get(id) ?? id).join(", ") || "(없음)"}`,
    metadata: { before: previous, after: next },
  })
  return NextResponse.json({ userIds: next })
}
