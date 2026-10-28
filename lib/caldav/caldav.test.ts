/**
 * CalDAV 클라이언트 · XML · iCalendar 파서. 픽스처는 10/27 실제 응답의 꼴에 지어낸 내용이다.
 * 실행: pnpm test:unit
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import {
  CalDavError,
  configuredCalendarNames,
  davConfigFromEnv,
  listCalendars,
  multiget,
  parseCalendarList,
  parseMultigetResult,
  parseSyncResult,
  rewindSyncToken,
  syncCollection,
} from "@/lib/caldav/client"
import { parseICalendar, parseIcalDate, parseDuration, unfold } from "@/lib/caldav/ical"
import { parseXml } from "@/lib/caldav/xml"

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "__fixtures__", name), "utf8")

// ─── XML ────────────────────────────────────────────────

test("XML: 네임스페이스 접두사를 떼고 로컬 이름으로 읽는다 (웍스는 caldav: 를 쓴다)", () => {
  const doc = parseXml(`<a:root xmlns:a="x"><caldav:calendar-data>본문</caldav:calendar-data></a:root>`)
  assert.equal(doc.children[0].name, "root")
  assert.equal(doc.children[0].children[0].name, "calendar-data")
})

test("XML: CDATA 안의 < & 는 그대로 둔다", () => {
  const doc = parseXml(`<r><![CDATA[a < b & c]]></r>`)
  assert.equal(doc.children[0].text, "a < b & c")
})

test("XML: 엔티티와 숫자 문자 참조를 푼다", () => {
  const doc = parseXml(`<r>A &amp; B &lt;&#44;&#x2C;&gt;</r>`)
  assert.equal(doc.children[0].text, "A & B <,,>")
})

test("XML: 짝이 안 맞으면 조용히 넘어가지 않고 던진다", () => {
  assert.throws(() => parseXml(`<a><b></a>`))
  assert.throws(() => parseXml(`<a>`))
})

// ─── PROPFIND · sync-collection · multiget ──────────────

test("캘린더 목록: 캘린더 홈 자신은 빼고 캘린더만, 이름과 ctag 를 읽는다", () => {
  const cals = parseCalendarList(fixture("propfind-home.xml"))
  assert.deepEqual(
    cals.map((c) => [c.displayName, c.ctag, c.externalId]),
    [
      ["예시 개인", "2026-10-20 17:26:02", "c_300000001_aaaaaaaa-0000-4000-8000-000000000001"],
      ["예시 회사 행사", "2026-10-27 15:46:13", "c_300000001_aaaaaaaa-0000-4000-8000-000000000002"],
      ["예시 외부 미팅 & 출장", "2026-08-05 13:12:00", "c_0_aaaaaaaa-0000-4000-8000-000000000003"],
    ]
  )
})

test("sync-collection: 404 는 묘비로, 나머지는 변경으로, 토큰을 읽는다", () => {
  const r = parseSyncResult(fixture("sync-collection.xml"))
  assert.equal(r.token, "2026-10-27 17:16:41")
  assert.equal(r.deleted.length, 1)
  assert.match(r.deleted[0], /example-web-0001\.ics$/)
  assert.deepEqual(
    r.changed.map((c) => c.etag),
    ['"2026-08-05 13:17:13"', '"2026-09-09 14:42:41"']
  )
  // href 는 퍼센트 인코딩 그대로 — multiget 에 되돌려 보낼 값이다
  assert.match(r.changed[0].href, /%40/)
})

test("multiget: 본문이 없는(404) 리소스는 결과에서 빠진다", () => {
  const res = parseMultigetResult(fixture("multiget.xml"))
  assert.equal(res.length, 2)
  assert.ok(res[0].data.startsWith("BEGIN:VCALENDAR"))
})

test("sync-token 은 3초 되돌려 저장한다 — 같은 초의 변경을 놓치지 않게", () => {
  assert.equal(rewindSyncToken("2026-10-27 17:16:41"), "2026-10-27 17:16:38")
  assert.equal(rewindSyncToken("2026-01-01 00:00:01"), "2025-12-31 23:59:58")
  assert.equal(rewindSyncToken("opaque-token"), "opaque-token")
  assert.equal(rewindSyncToken(null), null)
})

test("설정: 셋 중 하나라도 없으면 null, 캘린더 이름은 쉼표로", () => {
  assert.equal(davConfigFromEnv({ CALDAV_HOME_URL: "https://x/", CALDAV_USERNAME: "u" }), null)
  const cfg = davConfigFromEnv({ CALDAV_HOME_URL: "https://x/home", CALDAV_USERNAME: "u", CALDAV_PASSWORD: "p" })
  assert.equal(cfg?.homeUrl, "https://x/home/")
  assert.deepEqual(configuredCalendarNames({ CALDAV_CALENDARS: " Hadd Science, 대표님 일정 ,,바이오아이코어 2026" }), [
    "Hadd Science",
    "대표님 일정",
    "바이오아이코어 2026",
  ])
})

type Call = { url: string; method: string; depth: string | null; body: string; auth: string | null }

function fakeFetch(respond: (call: Call) => { status: number; body: string }) {
  const calls: Call[] = []
  const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      depth: headers.get("Depth"),
      body: String(init?.body ?? ""),
      auth: headers.get("Authorization"),
    }
    calls.push(call)
    const r = respond(call)
    return new Response(r.body, { status: r.status })
  }) as typeof fetch
  return { fetcher, calls }
}

const cfg = { homeUrl: "https://caldav.example.com/rl/1/caldav/2/calendar/", username: "u@x", password: "secret-pw" }

test("요청: 읽기 메서드만 보내고, 홈 PROPFIND 는 Depth 1, sync-collection 은 Depth 0", async () => {
  const { fetcher, calls } = fakeFetch((c) =>
    c.method === "PROPFIND" ? { status: 207, body: fixture("propfind-home.xml") } : { status: 207, body: fixture("sync-collection.xml") }
  )
  await listCalendars(cfg, fetcher)
  await syncCollection(cfg, "/rl/1/caldav/2/calendar/c_1/", "2026-10-27 17:16:38", fetcher)
  assert.deepEqual(
    calls.map((c) => [c.method, c.depth]),
    [
      ["PROPFIND", "1"],
      ["REPORT", "0"],
    ]
  )
  // 상대 href 는 홈의 호스트로 붙는다
  assert.equal(calls[1].url, "https://caldav.example.com/rl/1/caldav/2/calendar/c_1/")
  assert.match(calls[1].body, /<D:sync-token>2026-10-27 17:16:38<\/D:sync-token>/)
  assert.equal(calls[0].auth, `Basic ${Buffer.from("u@x:secret-pw").toString("base64")}`)
})

test("요청: multiget 은 100개씩 나눠 보내고 href 의 & 를 이스케이프한다", async () => {
  const { fetcher, calls } = fakeFetch(() => ({ status: 207, body: `<D:multistatus xmlns:D="DAV:"/>` }))
  const hrefs = Array.from({ length: 205 }, (_, i) => `/c/e${i}&x.ics`)
  await multiget(cfg, "/c/", hrefs, fetcher)
  assert.equal(calls.length, 3)
  assert.equal(calls[2].body.match(/<D:href>/g)?.length, 5)
  assert.match(calls[0].body, /e0&amp;x\.ics/)
})

test("오류: 207 이 아니면 던지고, 메시지에 자격증명을 싣지 않는다", async () => {
  const { fetcher } = fakeFetch(() => ({ status: 401, body: "nope" }))
  await assert.rejects(listCalendars(cfg, fetcher), (e: unknown) => {
    assert.ok(e instanceof CalDavError)
    assert.equal(e.status, 401)
    assert.match(e.message, /앱 비밀번호/)
    assert.doesNotMatch(e.message, /secret-pw|u@x/)
    return true
  })
})

// ─── iCalendar ──────────────────────────────────────────

test("iCal: LF 줄바꿈과 접힌 줄을 모두 받는다", () => {
  assert.deepEqual(unfold("A:1\r\nB:2\n  이어짐\nC:3"), ["A:1", "B:2 이어짐", "C:3"])
})

test("iCal: 한 리소스의 마스터와 예외 회차를 둘 다 꺼낸다 — 같은 UID", () => {
  const [res] = parseMultigetResult(fixture("multiget.xml"))
  const events = parseICalendar(res.data)
  assert.equal(events.length, 2)
  const [master, exception] = events
  assert.equal(master.uid, exception.uid)
  assert.equal(master.recurrenceId, "")
  assert.equal(master.rrule, "FREQ=WEEKLY;UNTIL=20251209T090000Z;INTERVAL=1;BYDAY=WE")
  // 서울 18:00 = UTC 09:00
  assert.equal(master.startAt.toISOString(), "2025-09-03T09:00:00.000Z")
  assert.equal(master.endAt.toISOString(), "2025-09-03T13:00:00.000Z")
  assert.deepEqual(
    master.exdates.map((d) => d.toISOString()),
    ["2025-10-08T09:00:00.000Z"]
  )
  // 예외 회차의 키는 원래 시각(서울 11/26 18:00), 실제 시작은 옮겨진 20:30
  assert.equal(exception.recurrenceId, "2025-11-26T09:00:00.000Z")
  assert.equal(exception.startAt.toISOString(), "2025-11-26T11:30:00.000Z")
  assert.equal(exception.rrule, null)
  assert.equal(exception.description, "세미나실 B, 2층\n간식 준비")
  assert.equal(master.description, null)
  assert.equal(master.className, "PUBLIC")
})

test("iCal: 종일 일정은 서울 자정 기준, VALARM 의 DESCRIPTION 은 일정 설명이 아니다", () => {
  const [, res] = parseMultigetResult(fixture("multiget.xml"))
  const [ev] = parseICalendar(res.data)
  assert.equal(ev.isAllDay, true)
  assert.equal(ev.startAt.toISOString(), "2026-11-02T15:00:00.000Z")
  assert.equal(ev.endAt.toISOString(), "2026-11-03T15:00:00.000Z")
  assert.equal(ev.description, null)
  assert.equal(ev.location, "본사")
  assert.equal(ev.organizer, "organizer@example.com")
  assert.deepEqual(ev.attendees, [
    { email: "kim@example.com", name: "김예시", partstat: "ACCEPTED" },
    // 따옴표 안의 쉼표는 매개변수 구분자가 아니다
    { email: "lee@example.com", name: "이예시, 팀장", partstat: "NEEDS-ACTION" },
  ])
})

test("iCal: DTEND 가 없으면 DURATION, 그것도 없으면 종일 하루 · 시각 일정 0분", () => {
  const ics = (body: string) => `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:x\n${body}\nEND:VEVENT\nEND:VCALENDAR`
  const [a] = parseICalendar(ics("DTSTART:20261028T010000Z\nDURATION:PT1H30M"))
  assert.equal(a.endAt.toISOString(), "2026-10-28T02:30:00.000Z")
  const [b] = parseICalendar(ics("DTSTART;VALUE=DATE:20261028"))
  assert.equal(b.endAt.getTime() - b.startAt.getTime(), 86_400_000)
  const [c] = parseICalendar(ics("DTSTART:20261028T010000Z"))
  assert.equal(c.endAt.getTime(), c.startAt.getTime())
  assert.deepEqual(parseICalendar(ics("SUMMARY:시작 없음")), [])
})

test("iCal: 시간대 — Z 는 UTC, TZID 없는 시각은 서울, 다른 TZID 는 그 시간대", () => {
  assert.equal(parseIcalDate("20261028T090000Z", {})?.instant.toISOString(), "2026-10-28T09:00:00.000Z")
  assert.equal(parseIcalDate("20261028T090000", {})?.instant.toISOString(), "2026-10-28T00:00:00.000Z")
  assert.equal(
    parseIcalDate("20260701T090000", { TZID: "America/New_York" })?.instant.toISOString(),
    "2026-07-01T13:00:00.000Z"
  )
  // 모르는 TZID 는 서울로
  assert.equal(
    parseIcalDate("20261028T090000", { TZID: "Korea Standard Time" })?.instant.toISOString(),
    "2026-10-28T00:00:00.000Z"
  )
  assert.equal(parseDuration("P1W"), 7 * 86_400_000)
  assert.equal(parseDuration("-PT15M"), -15 * 60_000)
})
