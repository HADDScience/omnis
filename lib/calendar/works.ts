/**
 * 저장해 둔 웍스 일정을 조회 창의 회차들로 바꾼다. DB 를 부르지 않는 순수 함수다.
 *
 * - 반복 마스터는 창에 맞춰 펼치고 EXDATE 를 뺀다 (recurrence.ts)
 * - 예외 회차(RECURRENCE-ID)가 있으면 그 원래 회차는 그리지 않는다. 예외 회차는 자기 시각에 그린다 —
 *   예외가 창 밖으로 옮겨졌어도 원래 자리는 비워야 하므로, 부르는 쪽은 창과 상관없이
 *   그 마스터의 예외를 전부 넘긴다
 * - STATUS:CANCELLED 는 그리지 않는다. 예외 회차가 취소된 것이면 원래 자리도 비운다
 * - 규칙을 못 읽으면(BYSETPOS 등) 마스터 한 번만 그린다
 */

import { expandOccurrences } from "@/lib/calendar/recurrence"
import type { CalendarItem } from "@/lib/calendar/types"

export type WorksRow = {
  id: string
  calendarId: string
  calendarName: string
  uid: string
  recurrenceId: string
  summary: string
  description: string | null
  location: string | null
  startAt: Date
  endAt: Date
  isAllDay: boolean
  tzid: string | null
  rrule: string | null
  exdates: Date[]
  status: string | null
}

const overlaps = (start: Date, end: Date, from: Date, until: Date) =>
  start < until && (end > from || (start.getTime() === end.getTime() && start >= from))

function toItem(row: WorksRow, start: Date, end: Date, id: string, recurring: boolean): CalendarItem {
  return {
    id,
    group: "works",
    tag: row.calendarName,
    title: row.summary || "(제목 없음)",
    start: start.toISOString(),
    end: end.toISOString(),
    allDay: row.isAllDay,
    href: null,
    calendarId: row.calendarId,
    recurring,
    location: row.location,
    description: row.description,
    muted: row.status === "TENTATIVE",
  }
}

export function worksItems(rows: WorksRow[], from: Date, until: Date): CalendarItem[] {
  const items: CalendarItem[] = []
  const cancelled = (r: WorksRow) => r.status === "CANCELLED"

  // 마스터마다 예외 회차의 원래 시각들
  const overridden = new Map<string, Set<string>>()
  for (const r of rows) {
    if (r.recurrenceId === "") continue
    const key = `${r.calendarId}\u0000${r.uid}`
    overridden.set(key, (overridden.get(key) ?? new Set()).add(r.recurrenceId))
  }

  for (const r of rows) {
    if (cancelled(r)) continue

    if (r.recurrenceId !== "" || !r.rrule) {
      if (overlaps(r.startAt, r.endAt, from, until)) {
        items.push(toItem(r, r.startAt, r.endAt, `works:${r.id}`, r.recurrenceId !== ""))
      }
      continue
    }

    const occ = expandOccurrences(
      { start: r.startAt, end: r.endAt, isAllDay: r.isAllDay, tzid: r.tzid, rrule: r.rrule, exdates: r.exdates },
      from,
      until
    )
    if (occ === null) {
      if (overlaps(r.startAt, r.endAt, from, until)) items.push(toItem(r, r.startAt, r.endAt, `works:${r.id}`, true))
      continue
    }
    const skip = overridden.get(`${r.calendarId}\u0000${r.uid}`)
    for (const o of occ) {
      if (skip?.has(o.key)) continue
      items.push(toItem(r, o.start, o.end, `works:${r.id}:${o.key}`, true))
    }
  }
  return items
}
