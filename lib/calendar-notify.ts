// 새 일정 알림 — 웍스 동기화(lib/caldav/sync.ts)가 새로 들여온 일정을 그 캘린더를 볼 수 있는 사람에게 알린다.
// 벨에도 남긴다(calendar_event_added). 누르면 캘린더의 그 날짜(?day=). 규칙: lib/notify-rules.ts 「일정」
//   - 그 캘린더의 첫 동기화에는 보내지 않는다 — 기존 일정 수백 건이 한꺼번에 알림이 된다
//   - 공개 범위(audience)를 넓혀도 일정 행이 새로 생기지 않으므로 보내지 않는다
//   - 바뀐 일정 · 취소된 일정은 이번 범위 밖이다. 반복 일정은 마스터 하나만 센다
import { prisma } from "@/lib/db"
import { createNotification } from "@/lib/notifications"
import { SYSTEM_USER_ID } from "@/lib/system-user"
import {
  calendarEventsToNotify,
  calendarNotices,
  calendarRecipients,
  type CalendarAudience,
  type NewCalendarEvent,
} from "@/lib/notify-rules"

export interface CalendarCreates {
  calendar: { id: string; displayName: string; audience: CalendarAudience }
  /** 이번 주기에 새로 생긴 행(마스터 · 예외 회차 모두 — 거르는 것은 규칙이 한다) */
  created: NewCalendarEvent[]
  /** 이 주기가 그 캘린더의 첫 성공 동기화인가(syncedAt 이 비어 있었다) */
  firstSync: boolean
}

export const CALENDAR_NOTIFICATION_TYPE = "calendar_event_added"

/** 알림을 만든다. 누구에게 몇 건 보냈는지 돌려준다(검증 스크립트 · 로그) */
export async function notifyNewCalendarEvents(
  batches: CalendarCreates[],
  now = new Date()
): Promise<{ calendar: string; notices: number; recipients: string[] }[]> {
  const plans = batches
    .map((b) => ({ b, notices: calendarNotices(b.calendar.displayName, calendarEventsToNotify({ firstSync: b.firstSync, created: b.created, now })) }))
    .filter((p) => p.notices.length > 0)
  if (plans.length === 0) return []

  const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true, role: true, email: true } })
  const out: { calendar: string; notices: number; recipients: string[] }[] = []
  for (const { b, notices } of plans) {
    const sent = new Set<string>()
    for (const n of notices) {
      const recipients = calendarRecipients({ audience: b.calendar.audience, users, organizer: n.organizer, systemUserId: SYSTEM_USER_ID })
      await Promise.all(
        recipients.map((uid) =>
          createNotification(uid, CALENDAR_NOTIFICATION_TYPE, n.title, n.content, n.entityId).catch((err) =>
            console.error("[calendar-notify] 알림 실패", { uid, err })
          )
        )
      )
      recipients.forEach((r) => sent.add(r))
    }
    out.push({ calendar: b.calendar.displayName, notices: notices.length, recipients: [...sent] })
  }
  return out
}
