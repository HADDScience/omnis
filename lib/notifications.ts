import { prisma } from "@/lib/db"
import { sendPushToUser } from "@/lib/push"
import {
  ALLOWED_RESPONSES,
  NotificationActionSchema,
  notificationHref,
  type NotificationAction,
  type NotificationResponse,
} from "@/lib/schemas/notification"

export type ActionResult =
  | { ok: true; alreadyResolved?: true; status?: "DONE" }
  | { error: string; code: 400 | 404 }

/**
 * 액션 알림에 응답한다 — 화면(PATCH /api/notifications)과 MCP(respond_notification)가 같은 길을 쓴다.
 * 라우트에서 옮겼다(2026-09-14).
 *
 * 응답 기록(resolvedAt)을 `resolvedAt: null` 조건부 updateMany 로 먼저 선점해,
 * 더블클릭이나 두 탭에서 동시에 눌러도 부수효과(업무 완료 처리·지시자 알림)가
 * 두 번 일어나지 않게 한다.
 */
export async function respondToAction(
  userId: string,
  userName: string,
  notificationId: string,
  response: NotificationResponse
): Promise<ActionResult> {
  const notification = await prisma.notification.findFirst({
    where: { id: notificationId, userId },
  })
  if (!notification) return { error: "알림 없음", code: 404 }

  const action = NotificationActionSchema.safeParse(notification.actionType)
  if (!action.success) return { error: "응답할 수 있는 알림이 아닙니다", code: 400 }
  if (!ALLOWED_RESPONSES[action.data].includes(response)) {
    return { error: "이 알림에 허용되지 않는 응답입니다", code: 400 }
  }

  const claimed = await prisma.notification.updateMany({
    where: { id: notificationId, userId, resolvedAt: null },
    data: { resolvedAt: new Date(), read: true },
  })
  // 이미 응답한 알림 — 부수효과를 다시 일으키지 않고 조용히 성공 처리한다.
  if (claimed.count === 0) return { ok: true, alreadyResolved: true }

  const taskId = notification.entityId
  if (!taskId) return { ok: true }

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, slug: true, name: true, instructorId: true, status: true },
  })
  if (!task) return { ok: true }

  if (response === "accept") {
    await notifyInstructor(
      task.instructorId,
      userId,
      "task_accepted",
      `업무 확인: ${task.name}`,
      `${userName}님이 #${task.slug} 업무를 확인했습니다.`,
      task.id
    )
    return { ok: true }
  }

  if (response === "confirm_done") {
    await prisma.$transaction([
      prisma.task.update({
        where: { id: task.id },
        data: { status: "DONE", workEnd: new Date() },
      }),
      prisma.checklist.updateMany({
        where: { taskId: task.id, done: false },
        data: { done: true },
      }),
    ])
    await notifyInstructor(
      task.instructorId,
      userId,
      "task_status_changed",
      "업무 완료",
      `${userName}님이 #${task.slug} 업무를 완료했습니다.`,
      task.id
    )
    // 업무가 끝나면 그 대화에서 회사 지식을 뽑아 카드 갱신을 제안한다 (실패해도 완료는 그대로).
    // 화면과 MCP(respond_notification)가 모두 여기를 지난다. 순환 import 를 피하려고 필요할 때 불러온다.
    void import("@/lib/card-proposals").then((m) => m.proposeFromTaskSafe(task.id, { trigger: "task_done", userId }))
    return { ok: true, status: "DONE" }
  }

  // defer — 응답 기록만 남긴다. 마감일이 지나면 다시 물어본다.
  return { ok: true }
}

async function notifyInstructor(
  instructorId: string,
  actorId: string,
  type: string,
  title: string,
  content: string,
  entityId: string
) {
  if (instructorId === actorId) return
  // 직접 만들지 않고 단일 진입점을 지난다 — 푸시도 여기서 함께 나간다.
  await createNotification(instructorId, type, title, content, entityId)
}

/**
 * 알림 생성 단일 진입점.
 *
 * `actionType` 을 주면 "응답이 필요한 알림"이 된다 — 사용자가 응답하기 전까지
 * 목록에서 지워지지 않고 남아, 화면이 대신 재촉한다 (인수인계 §4-2 잔상).
 *
 * 같은 대상(entityId)에 같은 액션이 이미 미해결로 떠 있으면 새로 만들지 않는다.
 * 채팅 재구성은 메시지마다 돌기 때문에, 막지 않으면 "완료로 표시할까요?"가 쌓인다.
 */
export async function createNotification(
  userId: string,
  type: string,
  title: string,
  content: string,
  entityId: string,
  actionType?: NotificationAction
) {
  if (actionType) {
    const pending = await prisma.notification.findFirst({
      where: { userId, entityId, actionType, resolvedAt: null },
      select: { id: true },
    })
    if (pending) return null
  }

  const notification = await prisma.notification.create({
    data: { userId, type, title, content, entityId, actionType: actionType ?? null },
  })

  // 탭이 닫혀 있어도 닿게 한다. 기다리지 않는다 — 푸시 서비스가 느리다고 업무 처리가
  // 함께 느려지면 안 되고, 실패해도 알림 행은 이미 만들어졌으므로 벨에서 보인다.
  void sendPushToUser(userId, {
    title,
    body: content,
    url: notificationHref(type, entityId) ?? undefined,
    // 같은 대상의 알림은 기기에서 서로를 덮어쓴다 — 잠금화면에 같은 업무가 쌓이지 않게
    tag: `omnis:${entityId}`,
  }).catch(() => {})

  return notification
}

/**
 * 대상(entityId)에 걸린 미해결 액션 알림을 일괄 해소한다.
 * 사용자가 알림을 거치지 않고 업무 상세에서 직접 상태를 바꾼 경우,
 * 알림만 남아 계속 재촉하는 것을 막는다.
 */
export async function resolveActionsFor(entityId: string, actionType: NotificationAction) {
  await prisma.notification.updateMany({
    where: { entityId, actionType, resolvedAt: null },
    data: { resolvedAt: new Date() },
  })
}
