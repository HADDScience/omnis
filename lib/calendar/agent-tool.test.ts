/**
 * 에이전트 · MCP 도구 list_calendar — 기간 기본값 · 상한, 반복 펼침, 보기 권한, 잘림. 실행: pnpm test:unit
 *
 * DB 대신 작은 가짜 저장소를 쓴다. 가짜 읽기(fakeLoad)는 getCalendarItems 의 웍스 부분과 같은 순서로
 * **실제** visibleCalendarFilter(누가 보나) → worksItems(회차 펼치기)를 거친다.
 */
import { test } from "node:test"
import assert from "node:assert/strict"

import {
  CALENDAR_TOOL_MAX_DAYS,
  CALENDAR_TOOL_MAX_ITEMS,
  calendarToolWindow,
  listCalendarText,
  type CalendarLoader,
} from "@/lib/calendar/agent-tool"
import { visibleCalendarFilter } from "@/lib/calendar/items"
import { fromWall, seoulDateKey, seoulDayLabel } from "@/lib/calendar/time"
import { worksItems, type WorksRow } from "@/lib/calendar/works"

const seoul = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  fromWall({ year: y, month: mo, day: d, hour: h, minute: mi, second: 0 }, "Asia/Seoul")

/** 2026-10-30(금) 12:00 서울 */
const NOW = seoul(2026, 10, 30, 12)

type FakeCalendar = { id: string; displayName: string; audience: "ALL" | "ADMIN"; syncedAt: Date | null }

const COMPANY: FakeCalendar = { id: "cal-all", displayName: "예시 회사 행사", audience: "ALL", syncedAt: seoul(2026, 10, 30, 9) }
const BOSS: FakeCalendar = { id: "cal-admin", displayName: "예시 대표 일정", audience: "ADMIN", syncedAt: seoul(2026, 10, 30, 11, 30) }

const row = (p: Partial<WorksRow> & Pick<WorksRow, "id" | "calendarId" | "summary" | "startAt" | "endAt">): WorksRow => ({
  calendarName: "",
  uid: p.id,
  recurrenceId: "",
  description: null,
  location: null,
  isAllDay: false,
  tzid: "Asia/Seoul",
  rrule: null,
  exdates: [],
  status: null,
  ...p,
})

/** getCalendarItems 의 웍스 부분을 흉내 — 보이는 캘린더만 고르고 그 일정을 창에 맞춰 펼친다 */
function fakeLoad(calendars: FakeCalendar[], rows: WorksRow[], seen: { viewer?: unknown; from?: Date; until?: Date } = {}): CalendarLoader {
  return async (q) => {
    seen.viewer = q.viewer
    seen.from = q.from
    seen.until = q.until
    const filter = visibleCalendarFilter(q.viewer) as { audience?: string }
    const visible = calendars.filter((c) => !filter.audience || c.audience === filter.audience)
    const name = new Map(visible.map((c) => [c.id, c.displayName]))
    const items = worksItems(
      rows.filter((r) => name.has(r.calendarId)).map((r) => ({ ...r, calendarName: name.get(r.calendarId)! })),
      q.from,
      q.until
    ).sort((a, b) => a.start.localeCompare(b.start))
    return {
      items,
      calendars: visible.map((c) => ({ id: c.id, displayName: c.displayName, audience: c.audience, syncedAt: c.syncedAt?.toISOString() ?? null })),
      worksConfigured: true,
    }
  }
}

const ADMIN = { id: "u-admin", isAdmin: true }
const MEMBER = { id: "u-member", isAdmin: false }

const text = (r: { text: string } | { error: string }) => {
  assert.ok("text" in r, "error" in r ? r.error : "")
  return r.text
}
const lines = (t: string) => t.split("\n").filter((l) => l.startsWith("- "))

// ─── 기간 ────────────────────────────────────────────────────────────

test("기본 창은 오늘(서울)부터 7일 — 끝은 7일째 다음 서울 자정", () => {
  const w = calendarToolWindow({}, NOW)
  assert.ok(!("error" in w))
  assert.equal(w.from.toISOString(), seoul(2026, 10, 30).toISOString())
  assert.equal(w.until.toISOString(), seoul(2026, 11, 6).toISOString())
})

test("오늘은 서울 날짜다 — UTC 로는 전날인 서울 새벽 1시", () => {
  const w = calendarToolWindow({}, seoul(2026, 10, 31, 1))
  assert.ok(!("error" in w))
  assert.equal(seoulDateKey(w.from), "2026-10-31")
  assert.equal(seoulDayLabel(seoul(2026, 10, 31, 1)), "2026-10-31(토)")
})

test("from 만 주면 그날부터 7일, from·to 를 주면 to 를 포함한다", () => {
  const a = calendarToolWindow({ from: "2026-11-02" }, NOW)
  assert.ok(!("error" in a))
  assert.equal(a.until.toISOString(), seoul(2026, 11, 9).toISOString())
  const b = calendarToolWindow({ from: "2026-11-01", to: "2026-11-30" }, NOW)
  assert.ok(!("error" in b))
  assert.equal(b.until.toISOString(), seoul(2026, 12, 1).toISOString())
})

test(`${CALENDAR_TOOL_MAX_DAYS}일을 넘으면 끝을 줄이고 그렇다고 적는다`, async () => {
  const w = calendarToolWindow({ from: "2026-01-01", to: "2026-12-31" }, NOW)
  assert.ok(!("error" in w))
  assert.equal(w.until.toISOString(), seoul(2026, 3, 4).toISOString()) // 1/1 + 62일
  assert.equal(w.clampedFrom, "2026-12-31")
  const seen: { from?: Date; until?: Date } = {}
  const t = text(await listCalendarText({ from: "2026-01-01", to: "2026-12-31" }, ADMIN, { now: NOW, load: fakeLoad([COMPANY], [], seen) }))
  assert.equal(seen.until!.toISOString(), seoul(2026, 3, 4).toISOString(), "읽기에도 줄인 창이 간다")
  assert.match(t, /요청한 끝 2026-12-31 은 한 번에 62일을 넘어 2026-03-03 까지만 읽었다/)
})

test("62일 딱 맞으면 줄이지 않는다", () => {
  const w = calendarToolWindow({ from: "2026-11-01", to: "2027-01-01" }, NOW)
  assert.ok(!("error" in w))
  assert.equal(w.clampedFrom, undefined)
})

test("거부되어야 하는 입력 — 없는 날짜 · 꼴이 틀린 날짜 · 거꾸로 된 기간 · 문자열 all_day", async () => {
  const load = fakeLoad([COMPANY], [])
  for (const bad of [{ from: "2026-02-30" }, { from: "11/4" }, { from: "2026-11-05", to: "2026-11-04" }, { all_day: "true" }, { from: 20261104 }]) {
    const r = await listCalendarText(bad, ADMIN, { now: NOW, load })
    assert.ok("error" in r, JSON.stringify(bad))
  }
})

// ─── 반복 펼침 ───────────────────────────────────────────────────────

const weekly = row({
  id: "w",
  calendarId: COMPANY.id,
  summary: "주간 회의 (예시)",
  startAt: seoul(2026, 10, 5, 10),
  endAt: seoul(2026, 10, 5, 11),
  rrule: "FREQ=WEEKLY;BYDAY=MO",
  exdates: [seoul(2026, 11, 16, 10)],
})

test("반복 일정은 회차마다 한 줄 — EXDATE 회차는 빠지고 「반복」 표시", async () => {
  const t = text(await listCalendarText({ from: "2026-11-01", to: "2026-11-30" }, ADMIN, { now: NOW, load: fakeLoad([COMPANY], [weekly]) }))
  const ls = lines(t)
  // 11월 월요일 2·9·16·23·30 중 16 은 EXDATE
  assert.deepEqual(
    ls.map((l) => l.slice(2, 12)),
    ["2026-11-02", "2026-11-09", "2026-11-23", "2026-11-30"]
  )
  assert.equal(ls[0], "- 2026-11-02(월) 10:00–11:00 · 주간 회의 (예시) · [예시 회사 행사] · 반복")
  assert.match(t, /^웍스 일정 2026-11-01\(일\) ~ 2026-11-30\(월\) \(Asia\/Seoul\) · 4건/)
})

test("종일 · 여러 날 · 미정 · 장소 표시", async () => {
  const rows = [
    row({ id: "a", calendarId: COMPANY.id, summary: "포럼 (예시)", startAt: seoul(2026, 11, 4), endAt: seoul(2026, 11, 5), isAllDay: true }),
    row({ id: "b", calendarId: COMPANY.id, summary: "학회 (예시)", startAt: seoul(2026, 11, 5), endAt: seoul(2026, 11, 7), isAllDay: true, location: "코엑스" }),
    row({ id: "c", calendarId: COMPANY.id, summary: "미팅 (예시)", startAt: seoul(2026, 11, 4, 22), endAt: seoul(2026, 11, 5, 1), status: "TENTATIVE" }),
  ]
  const ls = lines(text(await listCalendarText({ from: "2026-11-02", to: "2026-11-08" }, ADMIN, { now: NOW, load: fakeLoad([COMPANY], rows) })))
  assert.deepEqual(ls, [
    "- 2026-11-04(수) 종일 · 포럼 (예시) · [예시 회사 행사]",
    "- 2026-11-04(수) 22:00 – 2026-11-05(목) 01:00 · 미팅 (예시) · [예시 회사 행사] · 미정",
    "- 2026-11-05(목) ~ 2026-11-06(금) 종일 · 학회 (예시) · [예시 회사 행사] · 장소 코엑스",
  ])
})

// ─── 보기 권한 ───────────────────────────────────────────────────────

const bossOnly = row({ id: "boss", calendarId: BOSS.id, summary: "대표 외부 미팅 (예시)", startAt: seoul(2026, 11, 3, 15), endAt: seoul(2026, 11, 3, 16) })
const shared = row({ id: "shared", calendarId: COMPANY.id, summary: "전체 회의 (예시)", startAt: seoul(2026, 11, 3, 10), endAt: seoul(2026, 11, 3, 11) })

test("visibleCalendarFilter — 관리자는 전부, 구성원은 audience ALL 만", () => {
  assert.deepEqual(visibleCalendarFilter(ADMIN), {})
  assert.deepEqual(visibleCalendarFilter(MEMBER), { audience: "ALL" })
})

test("구성원은 관리자 전용 캘린더의 일정을 못 본다 (거부되어야 하는 경우)", async () => {
  const load = fakeLoad([COMPANY, BOSS], [bossOnly, shared])
  const member = text(await listCalendarText({ from: "2026-11-02", to: "2026-11-08" }, MEMBER, { now: NOW, load }))
  assert.doesNotMatch(member, /대표 외부 미팅/)
  assert.doesNotMatch(member, /예시 대표 일정/, "캘린더 이름도 드러나지 않는다")
  assert.match(member, /전체 회의/)
  // 캘린더 이름으로 집어 불러도 안 보인다
  const named = text(await listCalendarText({ from: "2026-11-02", to: "2026-11-08", calendar: "대표" }, MEMBER, { now: NOW, load }))
  assert.doesNotMatch(named, /대표 외부 미팅/)
  assert.match(named, /'대표' 에 맞는 캘린더가 없습니다/)

  const admin = text(await listCalendarText({ from: "2026-11-02", to: "2026-11-08" }, ADMIN, { now: NOW, load }))
  assert.match(admin, /대표 외부 미팅/)
  assert.match(admin, /전체 회의/)
})

test("볼 수 있는 캘린더가 없으면 그렇다고만 — 일정은 0", async () => {
  const t = text(await listCalendarText({}, MEMBER, { now: NOW, load: fakeLoad([BOSS], [bossOnly]) }))
  assert.match(t, /볼 수 있는 웍스 캘린더가 없습니다/)
  assert.equal(lines(t).length, 0)
})

test("부른 사람의 권한이 그대로 읽기에 간다", async () => {
  const seen: { viewer?: unknown } = {}
  await listCalendarText({}, MEMBER, { now: NOW, load: fakeLoad([COMPANY], [], seen) })
  assert.deepEqual(seen.viewer, MEMBER)
})

// ─── 거르기 · 잘림 · 동기화 ───────────────────────────────────────────

test("query 는 제목 · 장소에서 띄어 쓴 말을 모두 찾고, all_day 로 종일만 고른다", async () => {
  const rows = [
    row({ id: "1", calendarId: COMPANY.id, summary: "[혜린] 외근 (예시)", startAt: seoul(2026, 11, 4, 9), endAt: seoul(2026, 11, 4, 18) }),
    row({ id: "2", calendarId: COMPANY.id, summary: "[우창] 외근 (예시)", startAt: seoul(2026, 11, 4), endAt: seoul(2026, 11, 5), isAllDay: true }),
    row({ id: "3", calendarId: COMPANY.id, summary: "[혜린] 미팅 (예시)", startAt: seoul(2026, 11, 4, 14), endAt: seoul(2026, 11, 4, 15), location: "외근지" }),
  ]
  const load = fakeLoad([COMPANY], rows)
  const q = lines(text(await listCalendarText({ from: "2026-11-04", to: "2026-11-04", query: "혜린 외근" }, ADMIN, { now: NOW, load })))
  assert.equal(q.length, 2) // 제목의 「외근」 · 장소의 「외근지」
  const allDay = lines(text(await listCalendarText({ from: "2026-11-04", to: "2026-11-04", all_day: true }, ADMIN, { now: NOW, load })))
  assert.deepEqual(allDay, ["- 2026-11-04(수) 종일 · [우창] 외근 (예시) · [예시 회사 행사]"])
})

test(`${CALENDAR_TOOL_MAX_ITEMS}건을 넘으면 앞 ${CALENDAR_TOOL_MAX_ITEMS}건만 — 잘렸다고 적는다`, async () => {
  const many = Array.from({ length: 130 }, (_, i) =>
    row({ id: `m${i}`, calendarId: COMPANY.id, summary: `일정 ${i}`, startAt: seoul(2026, 11, 1 + (i % 28), 9, i % 60), endAt: seoul(2026, 11, 1 + (i % 28), 10, i % 60) })
  )
  const t = text(await listCalendarText({ from: "2026-11-01", to: "2026-11-30" }, ADMIN, { now: NOW, load: fakeLoad([COMPANY], many) }))
  assert.equal(lines(t).length, CALENDAR_TOOL_MAX_ITEMS)
  assert.match(t, /· 130건/)
  assert.match(t, /130건 중 앞 100건만 보였다\(잘림\)/)

  const few = text(await listCalendarText({ from: "2026-11-01", to: "2026-11-30" }, ADMIN, { now: NOW, load: fakeLoad([COMPANY], many.slice(0, 5)) }))
  assert.doesNotMatch(few, /잘림/)
})

test("마지막 동기화 — 가장 오래된 캘린더 기준으로 「최대 N시간」", async () => {
  const t = text(await listCalendarText({}, ADMIN, { now: NOW, load: fakeLoad([COMPANY, BOSS], []) }))
  assert.match(t, /마지막 동기화: 예시 회사 행사 2026-10-30 09:00 · 예시 대표 일정 2026-10-30 11:30/)
  assert.match(t, /최대 약 3시간 차이/)
  assert.match(t, /오늘: 2026-10-30\(금\)/)

  const never = text(await listCalendarText({}, ADMIN, { now: NOW, load: fakeLoad([{ ...COMPANY, syncedAt: null }], []) }))
  assert.match(never, /동기화 기록 없음/)
})
