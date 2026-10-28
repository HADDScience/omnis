/** 월 보기 칸 계산. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"

import {
  coversDay,
  gridWindow,
  isLongSpan,
  itemDayKeys,
  itemSpan,
  monthGrid,
  parseMonthKey,
  shiftMonth,
  spanLabel,
  timeLabel,
} from "@/lib/calendar/grid"
import { fromWall } from "@/lib/calendar/time"

const seoul = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  fromWall({ year: y, month: mo, day: d, hour: h, minute: mi, second: 0 }, "Asia/Seoul").toISOString()

test("월 칸: 일요일부터 42칸, 2026-10 은 9/27(일)부터 11/7(토)까지", () => {
  const days = monthGrid(2026, 10)
  assert.equal(days.length, 42)
  assert.equal(days[0].key, "2026-09-27")
  assert.equal(days[0].weekday, 0)
  assert.equal(days[41].key, "2026-11-07")
  assert.equal(days.filter((d) => d.inMonth).length, 31)
  const { from, until } = gridWindow(days)
  assert.equal(from.toISOString(), seoul(2026, 9, 27))
  assert.equal(until.toISOString(), seoul(2026, 11, 8))
})

test("걸치는 날: 종일은 끝 전날까지, 자정에 끝나는 시각 일정은 그날까지, 밤을 넘기면 이틀", () => {
  assert.deepEqual(itemDayKeys({ start: seoul(2026, 11, 3), end: seoul(2026, 11, 4) }), ["2026-11-03"])
  assert.deepEqual(itemDayKeys({ start: seoul(2025, 11, 26, 20, 30), end: seoul(2025, 11, 27) }), ["2025-11-26"])
  assert.deepEqual(itemDayKeys({ start: seoul(2025, 9, 3, 22), end: seoul(2025, 9, 4, 2) }), ["2025-09-03", "2025-09-04"])
  // 길이 0
  assert.deepEqual(itemDayKeys({ start: seoul(2026, 10, 28, 9), end: seoul(2026, 10, 28, 9) }), ["2026-10-28"])
  // 월말을 넘는 범위
  assert.deepEqual(itemDayKeys({ start: seoul(2026, 10, 30), end: seoul(2026, 11, 2) }), ["2026-10-30", "2026-10-31", "2026-11-01"])
})

test("긴 기간은 칸이 아니라 띠로 — 7일 초과", () => {
  assert.equal(isLongSpan({ start: seoul(2026, 10, 1), end: seoul(2026, 10, 8) }), false)
  assert.equal(isLongSpan({ start: seoul(2026, 10, 1), end: seoul(2026, 10, 9) }), true)
})

test("월 이동 · 키 · 시간 표기", () => {
  assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 })
  assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 })
  assert.deepEqual(parseMonthKey("2026-10"), { year: 2026, month: 10 })
  assert.equal(parseMonthKey("2026-13"), null)
  assert.equal(parseMonthKey(null), null)
  assert.equal(timeLabel(seoul(2026, 10, 28, 14, 8)), "오후 2:08")
  assert.equal(timeLabel(seoul(2026, 10, 28, 0, 5)), "오전 12:05")
  assert.equal(timeLabel(seoul(2026, 10, 28, 12, 0)), "오후 12:00")
})

test("400일 넘는 기간도 끝이 잘리지 않는다 — 1년 넘는 지원사업이 「5월 5일」에서 끊겼던 버그", () => {
  const grant = { start: seoul(2025, 4, 1), end: seoul(2027, 1, 1) }
  assert.deepEqual(itemSpan(grant), { first: "2025-04-01", last: "2026-12-31" })
  assert.equal(spanLabel(grant), "2025년 4월 1일 – 2026년 12월 31일")
  assert.equal(coversDay(grant, "2026-11-30"), true)
  assert.equal(coversDay(grant, "2027-01-01"), false)
  assert.equal(spanLabel({ start: seoul(2026, 10, 1), end: seoul(2027, 1, 1) }), "10월 1일 – 12월 31일")
  assert.equal(spanLabel({ start: seoul(2026, 10, 28), end: seoul(2026, 10, 29) }), "10월 28일")
})
