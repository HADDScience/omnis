import { prisma } from "@/lib/db"
import type { NotificationAction } from "@/lib/schemas/notification"

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

  return prisma.notification.create({
    data: { userId, type, title, content, entityId, actionType: actionType ?? null },
  })
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
