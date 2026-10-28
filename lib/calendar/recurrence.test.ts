/**
 * RRULE 전개. 앞의 넷은 2026-10-27 에 웍스에서 실제로 본 구조를 그대로 옮긴 것이다
 * (mydocs/tech/calendar.md 1.2 「반복 일정」). 실행: pnpm test:unit
 */
import { test } from "node:test"
import assert from "node:assert/strict"

import { expandOccurrences, parseRRule, recurrenceEnd, type ExpandInput } from "@/lib/calendar/recurrence"
import { fromWall, seoulDateKey } from "@/lib/calendar/time"

const seoul = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  fromWall({ year: y, month: mo, day: d, hour: h, minute: mi, second: 0 }, "Asia/Seoul")
const days = (occ: { start: Date }[] | null) => (occ ?? []).map((o) => seoulDateKey(o.start))

/** 매주 수요일 18~22시, 2025-12-09 까지, 10/8 은 EXDATE */
const weeklyWed: ExpandInput = {
  start: seoul(2025, 9, 3, 18),
  end: seoul(2025, 9, 3, 22),
  isAllDay: false,
  tzid: "Asia/Seoul",
  rrule: "FREQ=WEEKLY;UNTIL=20251209T090000Z;INTERVAL=1;BYDAY=WE",
  exdates: [seoul(2025, 10, 8, 18)],
}

test("실측 ① 주간 반복: 9/3 부터 12/3 까지 수요일, EXDATE 하나 빠져 13회", () => {
  const occ = expandOccurrences(weeklyWed, seoul(2025, 1, 1), seoul(2026, 1, 1))
  assert.equal(occ?.length, 13)
  assert.equal(days(occ)[0], "2025-09-03")
  assert.equal(days(occ).at(-1), "2025-12-03")
  assert.ok(!days(occ).includes("2025-10-08"))
  // 시각은 매번 서울 18시
  assert.ok(occ!.every((o) => o.start.getUTCHours() === 9))
})

test("실측 ② UNTIL 경계: 12/9 18시(UTC 09:00)까지라 12/10 은 없다", () => {
  assert.deepEqual(days(expandOccurrences(weeklyWed, seoul(2025, 12, 1), seoul(2026, 1, 1))), ["2025-12-03"])
})

test("실측 ③ EXDATE: 서버는 이 창에서 일정을 돌려주지만 실제 회차는 없다", () => {
  // 10/27 에 웍스 time-range 가 EXDATE 를 무시하고 이 창에서 일정을 잡았다. 우리는 0회여야 한다
  assert.deepEqual(expandOccurrences(weeklyWed, seoul(2025, 10, 5, 9), seoul(2025, 10, 12, 9)), [])
})

test("실측 ④ 예외 회차를 덮어쓸 키: 원래 시각(서울 11/26 18시)의 UTC ISO", () => {
  const occ = expandOccurrences(weeklyWed, seoul(2025, 11, 26), seoul(2025, 11, 27))
  assert.deepEqual(
    occ?.map((o) => o.key),
    ["2025-11-26T09:00:00.000Z"]
  )
})

test("마스터가 창 밖이어도 창 안의 회차는 나온다", () => {
  const sat: ExpandInput = {
    start: seoul(2026, 9, 12, 9),
    end: seoul(2026, 9, 12, 12),
    isAllDay: false,
    tzid: "Asia/Seoul",
    rrule: "FREQ=WEEKLY;UNTIL=20261226T000000Z;INTERVAL=1;BYDAY=SA",
    exdates: [],
  }
  assert.deepEqual(days(expandOccurrences(sat, seoul(2026, 11, 1), seoul(2026, 12, 1))), [
    "2026-11-07",
    "2026-11-14",
    "2026-11-21",
    "2026-11-28",
  ])
  // UNTIL 은 포함 — 12/26 09:00 서울 = 00:00Z
  assert.equal(recurrenceEnd(sat)?.toISOString(), seoul(2026, 12, 26, 12).toISOString())
  assert.deepEqual(expandOccurrences(sat, seoul(2027, 2, 1), seoul(2027, 3, 1)), [])
})

test("창 앞에서 시작해 창 안으로 이어지는 회차도 넣는다", () => {
  const overnight: ExpandInput = { ...weeklyWed, start: seoul(2025, 9, 3, 22), end: seoul(2025, 9, 4, 2), exdates: [] }
  const occ = expandOccurrences(overnight, seoul(2025, 9, 11, 0), seoul(2025, 9, 12, 0))
  assert.deepEqual(days(occ), ["2025-09-10"])
})

test("COUNT 는 EXDATE 로 빠지는 회차도 센다 (RFC 5545)", () => {
  const daily: ExpandInput = {
    start: seoul(2026, 10, 1, 9),
    end: seoul(2026, 10, 1, 10),
    isAllDay: false,
    tzid: "Asia/Seoul",
    rrule: "FREQ=DAILY;COUNT=5",
    exdates: [seoul(2026, 10, 3, 9)],
  }
  assert.deepEqual(days(expandOccurrences(daily, seoul(2026, 9, 1), seoul(2026, 12, 1))), [
    "2026-10-01",
    "2026-10-02",
    "2026-10-04",
    "2026-10-05",
  ])
  assert.equal(recurrenceEnd(daily)?.toISOString(), seoul(2026, 10, 5, 10).toISOString())
})

test("INTERVAL=2 는 격주", () => {
  const biweekly: ExpandInput = { ...weeklyWed, rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=WE;COUNT=4", exdates: [] }
  assert.deepEqual(days(expandOccurrences(biweekly, seoul(2025, 1, 1), seoul(2026, 1, 1))), [
    "2025-09-03",
    "2025-09-17",
    "2025-10-01",
    "2025-10-15",
  ])
})

test("주간 반복의 BYDAY 여러 개 — 월·수·금", () => {
  const mwf: ExpandInput = { ...weeklyWed, start: seoul(2026, 10, 26, 9), end: seoul(2026, 10, 26, 10), rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR", exdates: [] }
  assert.deepEqual(days(expandOccurrences(mwf, seoul(2026, 10, 26), seoul(2026, 11, 2))), [
    "2026-10-26",
    "2026-10-28",
    "2026-10-30",
  ])
})

test("월간: 31일 반복은 31일이 없는 달을 건너뛰고, -1FR 은 마지막 금요일", () => {
  const d31: ExpandInput = { ...weeklyWed, start: seoul(2026, 1, 31, 9), end: seoul(2026, 1, 31, 10), rrule: "FREQ=MONTHLY;COUNT=4", exdates: [] }
  assert.deepEqual(days(expandOccurrences(d31, seoul(2026, 1, 1), seoul(2027, 1, 1))), [
    "2026-01-31",
    "2026-03-31",
    "2026-05-31",
    "2026-07-31",
  ])
  const lastFri: ExpandInput = { ...weeklyWed, start: seoul(2026, 10, 30, 16), end: seoul(2026, 10, 30, 17), rrule: "FREQ=MONTHLY;BYDAY=-1FR", exdates: [] }
  assert.deepEqual(days(expandOccurrences(lastFri, seoul(2026, 10, 1), seoul(2027, 1, 1))), [
    "2026-10-30",
    "2026-11-27",
    "2026-12-25",
  ])
  const bymd: ExpandInput = { ...weeklyWed, start: seoul(2026, 10, 1, 9), end: seoul(2026, 10, 1, 10), rrule: "FREQ=MONTHLY;BYMONTHDAY=1,-1;COUNT=4", exdates: [] }
  assert.deepEqual(days(expandOccurrences(bymd, seoul(2026, 1, 1), seoul(2027, 1, 1))), [
    "2026-10-01",
    "2026-10-31",
    "2026-11-01",
    "2026-11-30",
  ])
})

test("연간: BYMONTH=3;BYDAY=2SU 는 3월 둘째 일요일 (웍스 VTIMEZONE 에 실려 오던 꼴)", () => {
  const dst: ExpandInput = { ...weeklyWed, start: seoul(2026, 3, 8, 2), end: seoul(2026, 3, 8, 3), rrule: "FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", exdates: [] }
  assert.deepEqual(days(expandOccurrences(dst, seoul(2026, 1, 1), seoul(2029, 1, 1))), ["2026-03-08", "2027-03-14", "2028-03-12"])
  const birthday: ExpandInput = { ...weeklyWed, start: seoul(2024, 2, 29), end: seoul(2024, 3, 1), isAllDay: true, rrule: "FREQ=YEARLY", exdates: [] }
  // 2/29 반복은 윤년에만
  assert.deepEqual(days(expandOccurrences(birthday, seoul(2024, 1, 1), seoul(2029, 1, 1))), ["2024-02-29", "2028-02-29"])
})

test("종일 반복은 서울 날짜 기준으로 센다", () => {
  const allDay: ExpandInput = {
    start: seoul(2026, 10, 26),
    end: seoul(2026, 10, 27),
    isAllDay: true,
    tzid: null,
    rrule: "FREQ=WEEKLY;UNTIL=20261116",
    exdates: [seoul(2026, 11, 2)],
  }
  assert.deepEqual(days(expandOccurrences(allDay, seoul(2026, 10, 1), seoul(2027, 1, 1))), ["2026-10-26", "2026-11-09", "2026-11-16"])
})

test("끝없는 반복의 recurrenceEnd 는 null, 못 읽는 규칙은 null 을 돌려 마스터만 그리게 한다", () => {
  const forever: ExpandInput = { ...weeklyWed, rrule: "FREQ=WEEKLY;BYDAY=WE", exdates: [] }
  assert.equal(recurrenceEnd(forever), null)
  // 10년 뒤 창에서도 나온다
  assert.equal(expandOccurrences(forever, seoul(2035, 9, 3), seoul(2035, 9, 10))?.length, 1)

  const setpos: ExpandInput = { ...weeklyWed, rrule: "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1" }
  assert.equal(expandOccurrences(setpos, seoul(2025, 1, 1), seoul(2026, 1, 1)), null)
  assert.equal(recurrenceEnd(setpos)?.toISOString(), setpos.end.toISOString())
  assert.equal(parseRRule("FREQ=HOURLY"), null)
  assert.equal(parseRRule("FREQ=WEEKLY;BYDAY=2WE"), null)
})
