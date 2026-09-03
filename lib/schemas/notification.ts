import { z } from "zod"

/**
 * 알림 액션 단일 진실 소스 (SSOT).
 * 규칙 13 (omnis/CLAUDE.md): DB write · API 파싱 · UI 렌더가 모두 이 스키마를 경유한다.
 *
 * 설계 근거 (docs/인수인계-서비스개선.md §4-2):
 *   "문서로 가르치지 않는다 — 시스템이 행동을 유도한다."
 *   쓸 수 있는 도구는 순서·기본값·잔상 셋뿐. 여기서 담당하는 것은 **잔상**이다.
 *   응답하기 전까지 알림이 목록에서 사라지지 않아, 화면이 대신 재촉한다.
 */

/** 사용자의 명시적 응답이 필요한 알림 종류. Prisma `Notification.actionType` 과 동기화. */
export const NOTIFICATION_ACTION_VALUES = ["accept_task", "confirm_done"] as const
export const NotificationActionSchema = z.enum(NOTIFICATION_ACTION_VALUES)
export type NotificationAction = z.infer<typeof NotificationActionSchema>

/** 사용자가 알림에 보낼 수 있는 응답. */
export const NOTIFICATION_RESPONSE_VALUES = ["accept", "confirm_done", "defer"] as const
export const NotificationResponseSchema = z.enum(NOTIFICATION_RESPONSE_VALUES)
export type NotificationResponse = z.infer<typeof NotificationResponseSchema>

/**
 * 액션별로 허용되는 응답.
 * `accept_task` 에 거절이 없는 것은 운영 규칙(인수인계 §4-1 "업무 지시 시 담당자를 명확히 한다")
 * 때문이다 — 담당자는 이미 지시자가 확정했으므로 수락 여부가 아니라 확인 여부만 남는다.
 */
export const ALLOWED_RESPONSES: Record<NotificationAction, readonly NotificationResponse[]> = {
  accept_task: ["accept"],
  confirm_done: ["confirm_done", "defer"],
}

/** 액션 알림에 표시할 버튼. 순서대로 렌더된다. 첫 번째가 기본(primary) 액션. */
export const ACTION_BUTTONS: Record<
  NotificationAction,
  readonly { response: NotificationResponse; label: string; variant: "default" | "ghost" }[]
> = {
  accept_task: [{ response: "accept", label: "수락", variant: "default" }],
  confirm_done: [
    { response: "confirm_done", label: "완료로 표시", variant: "default" },
    { response: "defer", label: "아직이요", variant: "ghost" },
  ],
}

/** PATCH /api/notifications 요청 본문. 읽음 처리와 액션 응답을 한 엔드포인트에서 구분한다. */
export const NotificationPatchSchema = z.union([
  z.object({ readAll: z.literal(true) }),
  z.object({ id: z.string().min(1), response: NotificationResponseSchema }),
  z.object({ id: z.string().min(1) }),
])
export type NotificationPatch = z.infer<typeof NotificationPatchSchema>

/** 응답이 아직 필요한 알림인가 — 삭제 차단과 배지 카운트가 같은 판정을 쓰도록 한 곳에 둔다. */
export function isPendingAction(n: {
  actionType: string | null
  resolvedAt: Date | string | null
}): boolean {
  return n.actionType !== null && n.resolvedAt === null
}
