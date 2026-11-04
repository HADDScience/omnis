import { NextRequest, NextResponse } from "next/server"

import { auth } from "@/lib/auth"
import { apiError, parseJson } from "@/lib/api"
import { prisma } from "@/lib/db"
import { NotificationPrefsPatchSchema, type NotificationPrefs } from "@/lib/schemas/notification"

export const runtime = "nodejs"

/**
 * 내 종류별 기기 알림(푸시) — 채팅 · 업무 · 일정. 마이 → 기기 알림이 읽고 바꾼다.
 * 끄면 그 종류의 **푸시만** 멈춘다. 벨 기록은 그대로 남는다(mydocs/plans/2026-10-29-push-notifications.md).
 * 행이 없으면 전부 켜짐이다 — 처음 바꿀 때 행을 만든다.
 */
const shape = (row: { chatPush: boolean; taskPush: boolean; calendarPush: boolean } | null): NotificationPrefs => ({
  chat: row?.chatPush ?? true,
  task: row?.taskPush ?? true,
  calendar: row?.calendarPush ?? true,
})

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const row = await prisma.notificationPref.findUnique({ where: { userId: session.user.id } })
  return NextResponse.json(shape(row))
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const body = await parseJson(req)
  if (!body) return apiError(400, "잘못된 JSON 요청")
  const parsed = NotificationPrefsPatchSchema.safeParse(body)
  if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다")

  const data = {
    ...(parsed.data.chat !== undefined ? { chatPush: parsed.data.chat } : {}),
    ...(parsed.data.task !== undefined ? { taskPush: parsed.data.task } : {}),
    ...(parsed.data.calendar !== undefined ? { calendarPush: parsed.data.calendar } : {}),
  }
  const row = await prisma.notificationPref.upsert({
    where: { userId: session.user.id },
    create: { userId: session.user.id, ...data },
    update: data,
  })
  return NextResponse.json(shape(row))
}
