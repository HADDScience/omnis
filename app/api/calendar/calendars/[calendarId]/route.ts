import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { apiError } from "@/lib/api"
import { isAdminSession } from "@/lib/company-edit"
import { setCalendarAudience } from "@/lib/company-ops"

// 웍스 캘린더를 옴니스에서 누가 보는가. 웍스에서 보이는 사람과 옴니스 구성원이 같다는 보장이 없어
// 처음엔 관리자만 보이고, 관리자가 여기서 연다 (mydocs/tech/calendar.md 4장).

const PatchSchema = z.object({ audience: z.enum(["ALL", "ADMIN"]) })

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ calendarId: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  if (!isAdminSession(session)) return apiError(403, "관리자만 캘린더 공개범위를 바꿀 수 있습니다")

  const parsed = PatchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return apiError(400, "audience 는 ALL 또는 ADMIN")

  const { calendarId } = await params
  // 규칙은 lib/company-ops.ts setCalendarAudience(도구 set_calendar_audience 와 같다)
  const r = await setCalendarAudience(session.user.id, calendarId, parsed.data.audience)
  if (!r.ok) return apiError(r.status, r.error)
  return NextResponse.json(r.value)
}
