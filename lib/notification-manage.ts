// 알림 읽음 · 지우기 · 종류별 기기 알림 — 화면(app/api/notifications · notification-prefs)과 도구(manage_notifications ·
// set_notification_prefs)가 같이 부른다. 언제나 본인 알림 · 본인 설정만.
import { prisma } from "@/lib/db"
import type { NotificationPrefs } from "@/lib/schemas/notification"

/** 응답을 기다리는 알림(수락 · 완료 확인)은 지우지 않는다 — 응답해야 닫힌다 */
const KEEP_PENDING = { OR: [{ actionType: null }, { resolvedAt: { not: null } }] }

export type ManageResult = { ok: true; count: number } | { ok: false; status: 404 | 409; error: string }

/** 읽음 — id 하나 또는 all */
export async function markNotificationsRead(userId: string, target: { id: string } | { all: true }): Promise<ManageResult> {
  if ("all" in target) {
    const r = await prisma.notification.updateMany({ where: { userId, read: false }, data: { read: true } })
    return { ok: true, count: r.count }
  }
  const r = await prisma.notification.updateMany({ where: { id: target.id, userId }, data: { read: true } })
  return r.count === 0 ? { ok: false, status: 404, error: "알림 없음" } : { ok: true, count: r.count }
}

/** 지우기 — id 하나 또는 all(응답 대기 알림은 남긴다) */
export async function deleteNotifications(userId: string, target: { id: string } | { all: true }): Promise<ManageResult> {
  if ("all" in target) {
    const r = await prisma.notification.deleteMany({ where: { userId, ...KEEP_PENDING } })
    return { ok: true, count: r.count }
  }
  const r = await prisma.notification.deleteMany({ where: { id: target.id, userId, ...KEEP_PENDING } })
  if (r.count > 0) return { ok: true, count: r.count }
  const exists = await prisma.notification.findFirst({ where: { id: target.id, userId }, select: { id: true } })
  return exists
    ? { ok: false, status: 409, error: "응답이 필요한 알림은 삭제할 수 없습니다" }
    : { ok: false, status: 404, error: "알림 없음" }
}

/** 지우기 전에 보여 줄 것 — 지울 수 있는 알림만(응답 대기는 빠진다) */
export function deletableNotifications(userId: string, target: { id: string } | { all: true }) {
  return prisma.notification.findMany({
    where: { userId, ...KEEP_PENDING, ...("id" in target ? { id: target.id } : {}) },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, createdAt: true },
  })
}

type PrefRow = { chatPush: boolean; taskPush: boolean; calendarPush: boolean } | null
const shape = (row: PrefRow): NotificationPrefs => ({
  chat: row?.chatPush ?? true,
  task: row?.taskPush ?? true,
  calendar: row?.calendarPush ?? true,
})

/** 내 종류별 기기 알림 — 행이 없으면 전부 켜짐 */
export async function getNotificationPrefs(userId: string): Promise<NotificationPrefs> {
  return shape(await prisma.notificationPref.findUnique({ where: { userId } }))
}

/** 준 종류만 바꾼다. 처음 바꿀 때 행을 만든다 */
export async function setNotificationPrefs(userId: string, input: Partial<NotificationPrefs>): Promise<NotificationPrefs> {
  const data = {
    ...(input.chat !== undefined ? { chatPush: input.chat } : {}),
    ...(input.task !== undefined ? { taskPush: input.task } : {}),
    ...(input.calendar !== undefined ? { calendarPush: input.calendar } : {}),
  }
  const row = await prisma.notificationPref.upsert({ where: { userId }, create: { userId, ...data }, update: data })
  return shape(row)
}
