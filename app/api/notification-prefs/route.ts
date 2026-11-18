import { NextRequest, NextResponse } from "next/server"

import { auth } from "@/lib/auth"
import { apiError, parseJson } from "@/lib/api"
import { getNotificationPrefs, setNotificationPrefs } from "@/lib/notification-manage"
import { NotificationPrefsPatchSchema } from "@/lib/schemas/notification"

export const runtime = "nodejs"

/**
 * 내 종류별 기기 알림(푸시) — 채팅 · 업무 · 일정. 마이 → 기기 알림이 읽고 바꾼다.
 * 끄면 그 종류의 **푸시만** 멈춘다. 벨 기록은 그대로 남는다(mydocs/plans/2026-10-29-push-notifications.md).
 * 행이 없으면 전부 켜짐이다 — 처음 바꿀 때 행을 만든다.
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  return NextResponse.json(await getNotificationPrefs(session.user.id))
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const body = await parseJson(req)
  if (!body) return apiError(400, "잘못된 JSON 요청")
  const parsed = NotificationPrefsPatchSchema.safeParse(body)
  if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다")
  return NextResponse.json(await setNotificationPrefs(session.user.id, parsed.data))
}
