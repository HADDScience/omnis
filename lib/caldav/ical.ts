/**
 * iCalendar(RFC 5545) 에서 일정만 꺼낸다.
 *
 * 웍스가 주는 꼴에 맞췄다 (mydocs/tech/calendar.md 1.2, 2026-10-27 실측):
 * - 한 .ics 리소스에 VEVENT 가 여럿 들 수 있다 — 반복 일정의 마스터와 그 예외 회차가
 *   같은 UID 로 같이 온다. "리소스 1개 = 일정 1개" 로 읽으면 예외 회차가 마스터를 덮는다
 * - 줄바꿈이 CRLF 가 아니라 LF 로 온다. 둘 다 받는다
 * - 반복은 펼치지 않는다. RRULE · EXDATE 를 그대로 넘기고 펼치는 건 읽을 때 한다
 */

import { SEOUL, fromWall, normalizeTz } from "@/lib/calendar/time"

export type IcalProp = { name: string; params: Record<string, string>; value: string }

export type IcalAttendee = { email: string | null; name: string | null; partstat: string | null }

export type ParsedEvent = {
  uid: string
  /** 예외 회차의 원래 시각(UTC ISO). 마스터는 "" */
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
  sequence: number
  lastModified: Date | null
  organizer: string | null
  attendees: IcalAttendee[]
  /** PUBLIC · PRIVATE · CONFIDENTIAL */
  className: string | null
}

const DAY_MS = 86_400_000

/** 접힌 줄을 편다. 공백이나 탭으로 시작하는 줄은 앞 줄에 붙는다 */
export function unfold(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += raw.slice(1)
    } else if (raw.length > 0) {
      out.push(raw)
    }
  }
  return out
}

/** 따옴표 밖의 구분자로 자른다 — CN="성, 이름" 같은 값 안의 ; , : 를 지키려고 */
function splitOutsideQuotes(s: string, sep: string, limit = Infinity): string[] {
  const parts: string[] = []
  let cur = ""
  let quoted = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '"') quoted = !quoted
    if (ch === sep && !quoted && parts.length < limit - 1) {
      parts.push(cur)
      cur = ""
    } else {
      cur += ch
    }
  }
  parts.push(cur)
  return parts
}

export function parseProp(line: string): IcalProp | null {
  const [head, value] = splitOutsideQuotes(line, ":", 2)
  if (value === undefined) return null
  const [name, ...rawParams] = splitOutsideQuotes(head, ";")
  const params: Record<string, string> = {}
  for (const p of rawParams) {
    const eq = p.indexOf("=")
    if (eq < 0) continue
    params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "")
  }
  return { name: name.toUpperCase(), params, value }
}

/** TEXT 값의 이스케이프를 푼다 (\n \, \; \\) */
export function unescapeText(v: string): string {
  return v.replace(/\\([nN,;\\])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c))
}

export type IcalDate = { instant: Date; isDate: boolean; tzid: string | null }

/**
 * DATE · DATE-TIME 값을 UTC 순간으로.
 * - `20261028` (VALUE=DATE) → 서울 자정. 종일 일정은 회사 시간대의 날짜로 둔다
 * - `20261028T090000Z` → UTC
 * - `20261028T090000` + TZID → 그 시간대. TZID 가 없으면(floating) 서울로 본다
 */
export function parseIcalDate(value: string, params: Record<string, string>): IcalDate | null {
  const v = value.trim()
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(v)
  if (date) {
    const [, y, m, d] = date
    return {
      instant: fromWall({ year: +y, month: +m, day: +d, hour: 0, minute: 0, second: 0 }, SEOUL),
      isDate: true,
      tzid: null,
    }
  }
  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v)
  if (!dt) return null
  const [, y, m, d, hh, mm, ss, z] = dt
  if (z) {
    return { instant: new Date(Date.UTC(+y, +m - 1, +d, +hh, +mm, +ss)), isDate: false, tzid: "UTC" }
  }
  const tzid = params.TZID ? normalizeTz(params.TZID) : SEOUL
  return {
    instant: fromWall({ year: +y, month: +m, day: +d, hour: +hh, minute: +mm, second: +ss }, tzid),
    isDate: false,
    tzid,
  }
}

/** DURATION (PnW · PnDTnHnMnS) → 밀리초 */
export function parseDuration(v: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim())
  if (!m) return null
  const [, sign, w, d, h, mi, s] = m
  const ms = ((+(w ?? 0) * 7 + +(d ?? 0)) * 24 * 3600 + +(h ?? 0) * 3600 + +(mi ?? 0) * 60 + +(s ?? 0)) * 1000
  return sign === "-" ? -ms : ms
}

function mailto(v: string): string | null {
  const s = v.trim().replace(/^mailto:/i, "")
  return s.length > 0 ? s : null
}

/** VCALENDAR 텍스트 하나에서 VEVENT 를 모두 꺼낸다. UID 나 DTSTART 가 없는 것은 건너뛴다 */
export function parseICalendar(text: string): ParsedEvent[] {
  const events: ParsedEvent[] = []
  // 컴포넌트 중첩을 따라간다. VEVENT 안의 VALARM 이 DESCRIPTION 을 덮어쓰지 않게,
  // 바로 위 컴포넌트가 VEVENT 일 때의 속성만 모은다.
  const stack: string[] = []
  let props: IcalProp[] = []

  for (const line of unfold(text)) {
    const prop = parseProp(line)
    if (!prop) continue
    if (prop.name === "BEGIN") {
      stack.push(prop.value.trim().toUpperCase())
      if (stack[stack.length - 1] === "VEVENT") props = []
      continue
    }
    if (prop.name === "END") {
      const closed = stack.pop()
      if (closed === "VEVENT") {
        const ev = toEvent(props)
        if (ev) events.push(ev)
      }
      continue
    }
    if (stack[stack.length - 1] === "VEVENT") props.push(prop)
  }
  return events
}

function toEvent(props: IcalProp[]): ParsedEvent | null {
  const one = (name: string) => props.find((p) => p.name === name)
  const uid = one("UID")?.value.trim()
  const dtstartProp = one("DTSTART")
  if (!uid || !dtstartProp) return null
  const start = parseIcalDate(dtstartProp.value, dtstartProp.params)
  if (!start) return null

  let endAt: Date
  const dtend = one("DTEND")
  const duration = one("DURATION")
  const end = dtend ? parseIcalDate(dtend.value, dtend.params) : null
  if (end) {
    endAt = end.instant
  } else if (duration && parseDuration(duration.value) !== null) {
    endAt = new Date(start.instant.getTime() + parseDuration(duration.value)!)
  } else {
    // RFC 5545: DTEND 가 없으면 종일은 하루, 시각 일정은 길이 0
    endAt = new Date(start.instant.getTime() + (start.isDate ? DAY_MS : 0))
  }
  if (endAt < start.instant) endAt = start.instant

  const rid = one("RECURRENCE-ID")
  const ridDate = rid ? parseIcalDate(rid.value, rid.params) : null

  const exdates: Date[] = []
  for (const p of props.filter((x) => x.name === "EXDATE")) {
    for (const v of p.value.split(",")) {
      const d = parseIcalDate(v, p.params)
      if (d) exdates.push(d.instant)
    }
  }

  const lm = one("LAST-MODIFIED")
  const organizer = one("ORGANIZER")
  const text = (name: string) => {
    const p = one(name)
    if (!p) return null
    const v = unescapeText(p.value).trim()
    return v.length > 0 ? v : null
  }

  return {
    uid,
    recurrenceId: ridDate ? ridDate.instant.toISOString() : "",
    summary: text("SUMMARY") ?? "",
    description: text("DESCRIPTION"),
    location: text("LOCATION"),
    startAt: start.instant,
    endAt,
    isAllDay: start.isDate,
    tzid: start.isDate ? null : start.tzid,
    // 예외 회차는 자기 RRULE 을 갖지 않는다. 혹시 실려 와도 마스터의 것만 쓴다
    rrule: ridDate ? null : (one("RRULE")?.value.trim() ?? null),
    exdates: ridDate ? [] : exdates,
    status: one("STATUS")?.value.trim().toUpperCase() ?? null,
    sequence: Number(one("SEQUENCE")?.value ?? 0) || 0,
    lastModified: lm ? (parseIcalDate(lm.value, lm.params)?.instant ?? null) : null,
    organizer: organizer ? mailto(organizer.value) : null,
    attendees: props
      .filter((p) => p.name === "ATTENDEE")
      .map((p) => ({ email: mailto(p.value), name: p.params.CN ?? null, partstat: p.params.PARTSTAT ?? null })),
    className: one("CLASS")?.value.trim().toUpperCase() ?? null,
  }
}
