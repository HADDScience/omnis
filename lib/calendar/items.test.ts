/**
 * 캘린더 읽기 모델의 순수한 부분 — 웍스 회차 병합과 날짜 칸 판정. 실행: pnpm test:unit
 */
import { test } from "node:test"
import assert from "node:assert/strict"

import { allDaySpan, calendarDate } from "@/lib/calendar/items"
import { fromWall, seoulDateKey } from "@/lib/calendar/time"
import { worksItems, type WorksRow } from "@/lib/calendar/works"

const seoul = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  fromWall({ year: y, month: mo, day: d, hour: h, minute: mi, second: 0 }, "Asia/Seoul")

const base: Omit<WorksRow, "id" | "uid" | "recurrenceId" | "startAt" | "endAt" | "rrule"> = {
  calendarId: "cal-1",
  calendarName: "예시 회사 행사",
  summary: "주간 연구 회의 (예시)",
  description: null,
  location: null,
  isAllDay: false,
  tzid: "Asia/Seoul",
  exdates: [],
  status: null,
}

/** 매주 수 18~22시 9/3~12/9, 10/8 EXDATE — 10/27 에 웍스에서 본 구조 */
const master: WorksRow = {
  ...base,
  id: "m",
  uid: "u-1",
  recurrenceId: "",
  startAt: seoul(2025, 9, 3, 18),
  endAt: seoul(2025, 9, 3, 22),
  rrule: "FREQ=WEEKLY;UNTIL=20251209T090000Z;INTERVAL=1;BYDAY=WE",
  exdates: [seoul(2025, 10, 8, 18)],
}
/** 11/26 18시 회차를 20:30 으로 옮긴 예외 */
const moved: WorksRow = {
  ...base,
  id: "x",
  uid: "u-1",
  recurrenceId: seoul(2025, 11, 26, 18).toISOString(),
  startAt: seoul(2025, 11, 26, 20, 30),
  endAt: seoul(2025, 11, 27, 0),
  rrule: null,
  summary: "주간 연구 회의 (예시) — 시간 변경",
}

const nov = [seoul(2025, 11, 1), seoul(2025, 12, 1)] as const

test("예외 회차가 원래 회차를 대신한다 — 11/26 은 한 번만, 20:30 에", () => {
  const items = worksItems([master, moved], ...nov)
  const on26 = items.filter((i) => seoulDateKey(new Date(i.start)) === "2025-11-26")
  assert.equal(on26.length, 1)
  assert.equal(on26[0].start, seoul(2025, 11, 26, 20, 30).toISOString())
  assert.equal(on26[0].title, "주간 연구 회의 (예시) — 시간 변경")
  // 11월 수요일 다섯 번(5·12·19·26) 중 26 은 예외로 — 총 4
  assert.equal(items.length, 4)
  assert.equal(new Set(items.map((i) => i.id)).size, items.length)
})

test("예외 회차가 창 밖으로 옮겨져도 원래 자리는 비운다", () => {
  const farAway: WorksRow = { ...moved, startAt: seoul(2026, 1, 7, 18), endAt: seoul(2026, 1, 7, 22) }
  const items = worksItems([master, farAway], ...nov)
  assert.ok(!items.some((i) => seoulDateKey(new Date(i.start)) === "2025-11-26"))
  assert.equal(items.length, 3)
})

test("취소된 예외 회차는 그리지 않고 원래 자리도 비운다", () => {
  const items = worksItems([master, { ...moved, status: "CANCELLED" }], ...nov)
  assert.equal(items.length, 3)
})

test("규칙을 못 읽으면 마스터 한 번만 — 틀린 회차를 그리지 않는다", () => {
  const odd: WorksRow = { ...master, rrule: "FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1", exdates: [] }
  assert.equal(worksItems([odd], seoul(2025, 9, 1), seoul(2025, 10, 1)).length, 1)
  assert.equal(worksItems([odd], ...nov).length, 0)
})

test("단일 일정 · 종일 일정은 창과 겹칠 때만", () => {
  const allDay: WorksRow = {
    ...base,
    id: "d",
    uid: "u-2",
    recurrenceId: "",
    isAllDay: true,
    tzid: null,
    startAt: seoul(2026, 11, 3),
    endAt: seoul(2026, 11, 4),
    rrule: null,
  }
  assert.equal(worksItems([allDay], seoul(2026, 11, 3), seoul(2026, 11, 4)).length, 1)
  assert.equal(worksItems([allDay], seoul(2026, 11, 4), seoul(2026, 11, 5)).length, 0)
  assert.equal(worksItems([allDay], seoul(2026, 11, 2), seoul(2026, 11, 3)).length, 0)
  assert.equal(worksItems([allDay], seoul(2026, 11, 3), seoul(2026, 11, 4))[0].allDay, true)
})

test("날짜 칸 판정: 서울 자정 · UTC 자정 · 실제 시각 모두 맞는 날", () => {
  // 업무 마감 — 서울 자정으로 저장된다 (10/28 = 10/27 15:00Z)
  assert.deepEqual(calendarDate(new Date("2026-10-27T15:00:00.000Z")), { year: 2026, month: 10, day: 28 })
  // 회사 기록 · CRM — UTC 자정으로 저장된다
  assert.deepEqual(calendarDate(new Date("2026-10-28T00:00:00.000Z")), { year: 2026, month: 10, day: 28 })
  // 실제 시각 — 서울 날짜. 23:30 KST 는 그날
  assert.deepEqual(calendarDate(new Date("2026-10-28T14:30:00.000Z")), { year: 2026, month: 10, day: 28 })
  // 서울 새벽 1시(전날 16:00Z)는 서울 날짜로
  assert.deepEqual(calendarDate(new Date("2026-10-27T16:00:00.000Z")), { year: 2026, month: 10, day: 28 })
})

test("종일 칸: 끝 날짜까지 포함하고, 끝이 앞이면 하루로", () => {
  const one = allDaySpan(new Date("2026-10-28T00:00:00Z"))
  assert.equal(one.start.toISOString(), "2026-10-27T15:00:00.000Z")
  assert.equal(one.end.toISOString(), "2026-10-28T15:00:00.000Z")
  const range = allDaySpan(new Date("2026-10-28T00:00:00Z"), new Date("2026-10-30T00:00:00Z"))
  assert.equal(range.end.toISOString(), "2026-10-30T15:00:00.000Z")
  const reversed = allDaySpan(new Date("2026-10-30T00:00:00Z"), new Date("2026-10-28T00:00:00Z"))
  assert.equal(reversed.end.getTime() - reversed.start.getTime(), 86_400_000)
})
