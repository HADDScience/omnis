import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { apiError } from "@/lib/api"
import { isAdminSession } from "@/lib/company-edit"
import { getCalendarItems } from "@/lib/calendar/items"
import { CALENDAR_GROUPS, type CalendarGroup } from "@/lib/calendar/types"

/** 월 보기는 앞뒤 주를 합쳐 6주(42일). 넉넉히 두되 한 번에 몇 년치를 긁지 못하게 */
const MAX_WINDOW_DAYS = 100

// GET /api/calendar?from=ISO&until=ISO&groups=works,tasks&taskScope=mine|all
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")

  const sp = new URL(req.url).searchParams
  const from = new Date(sp.get("from") ?? "")
  const until = new Date(sp.get("until") ?? "")
  if (Number.isNaN(from.getTime()) || Number.isNaN(until.getTime()) || until <= from) {
    return apiError(400, "from · until 은 ISO 시각이고 until 이 더 늦어야 합니다")
  }
  if (until.getTime() - from.getTime() > MAX_WINDOW_DAYS * 86_400_000) {
    return apiError(400, `한 번에 ${MAX_WINDOW_DAYS}일까지 볼 수 있습니다`)
  }

  const known = new Set<string>(CALENDAR_GROUPS.map((g) => g.key))
  const groups = (sp.get("groups") ?? CALENDAR_GROUPS.filter((g) => g.defaultOn).map((g) => g.key).join(","))
    .split(",")
    .filter((g): g is CalendarGroup => known.has(g))

  const data = await getCalendarItems({
    from,
    until,
    groups,
    viewer: { id: session.user.id, isAdmin: isAdminSession(session) },
    taskScope: sp.get("taskScope") === "all" ? "all" : "mine",
  })
  return NextResponse.json(data)
}
