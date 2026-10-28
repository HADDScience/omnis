/**
 * RRULE 전개. 웍스 CalDAV 는 `C:expand` 를 무시하고 마스터+RRULE 로만 준다 —
 * 펼치는 것은 우리 몫이다 (mydocs/tech/calendar.md 1.2 「반복 일정」).
 *
 * 벽시계 기준으로 센다. "매주 수요일 18시" 는 시간대가 바뀌어도 18시여야 하므로,
 * 마스터의 TZID 에서 날짜를 세고 각 회차를 그때 UTC 로 옮긴다.
 *
 * 지원: FREQ=DAILY·WEEKLY·MONTHLY·YEARLY, INTERVAL, COUNT, UNTIL, BYDAY(서수 포함),
 * BYMONTHDAY(음수 포함), BYMONTH, WKST.
 * 그 밖의 규칙(BYSETPOS · BYWEEKNO · BYYEARDAY · BYHOUR …)은 `null` 을 돌려주고,
 * 부르는 쪽은 마스터 한 번만 보여 준다. 틀린 회차를 그리느니 덜 그린다.
 */

import {
  SEOUL,
  type WallTime,
  addDays,
  daysInMonth,
  fromWall,
  normalizeTz,
  toWall,
  weekday,
} from "@/lib/calendar/time"

type Freq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY"
type ByDay = { wd: number; n: number | null }

export type Rule = {
  freq: Freq
  interval: number
  count: number | null
  until: Date | null
  /** UNTIL 이 날짜만 있으면 그 날(벽시계) 까지 */
  untilDate: { year: number; month: number; day: number } | null
  byDay: ByDay[]
  byMonthDay: number[]
  byMonth: number[]
  /** 0=일 … 6=토 */
  wkst: number
}

const WD: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }
const SUPPORTED = new Set(["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "BYMONTHDAY", "BYMONTH", "WKST"])

/** 회차를 무한정 세지 않는다. 하루에 한 번이면 27년치다 */
const MAX_STEPS = 10_000

export function parseRRule(raw: string): Rule | null {
  const kv: Record<string, string> = {}
  for (const part of raw.replace(/^RRULE:/i, "").split(";")) {
    const eq = part.indexOf("=")
    if (eq < 0) continue
    kv[part.slice(0, eq).trim().toUpperCase()] = part.slice(eq + 1).trim().toUpperCase()
  }
  if (Object.keys(kv).some((k) => !SUPPORTED.has(k))) return null
  const freq = kv.FREQ as Freq
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) return null

  const interval = kv.INTERVAL ? Number(kv.INTERVAL) : 1
  const count = kv.COUNT ? Number(kv.COUNT) : null
  if (!Number.isInteger(interval) || interval < 1) return null
  if (count !== null && (!Number.isInteger(count) || count < 1)) return null

  let until: Date | null = null
  let untilDate: Rule["untilDate"] = null
  if (kv.UNTIL) {
    const d = /^(\d{4})(\d{2})(\d{2})$/.exec(kv.UNTIL)
    const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/.exec(kv.UNTIL)
    if (d) untilDate = { year: +d[1], month: +d[2], day: +d[3] }
    else if (dt) until = new Date(Date.UTC(+dt[1], +dt[2] - 1, +dt[3], +dt[4], +dt[5], +dt[6]))
    else return null
  }

  const byDay: ByDay[] = []
  for (const token of kv.BYDAY ? kv.BYDAY.split(",") : []) {
    const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(token)
    if (!m) return null
    byDay.push({ wd: WD[m[2]], n: m[1] ? Number(m[1]) : null })
  }
  const byMonthDay = kv.BYMONTHDAY ? kv.BYMONTHDAY.split(",").map(Number) : []
  const byMonth = kv.BYMONTH ? kv.BYMONTH.split(",").map(Number) : []
  if (byMonthDay.some((d) => !Number.isInteger(d) || d === 0 || Math.abs(d) > 31)) return null
  if (byMonth.some((m) => !Number.isInteger(m) || m < 1 || m > 12)) return null
  // 서수 BYDAY 는 MONTHLY · YEARLY 에서만 뜻이 있다
  if ((freq === "DAILY" || freq === "WEEKLY") && byDay.some((b) => b.n !== null)) return null

  const wkst = kv.WKST ? WD[kv.WKST] : 1
  if (wkst === undefined) return null

  return { freq, interval, count, until, untilDate, byDay, byMonthDay, byMonth, wkst }
}

type YMD = { year: number; month: number; day: number }

/** 한 달 안에서 BYDAY 에 맞는 날들. n 이 있으면 n번째(음수면 끝에서) */
function monthDaysByWeekday(year: number, month: number, byDay: ByDay[]): number[] {
  const dim = daysInMonth(year, month)
  const out = new Set<number>()
  for (const b of byDay) {
    const days: number[] = []
    for (let d = 1; d <= dim; d++) if (weekday({ year, month, day: d }) === b.wd) days.push(d)
    if (b.n === null) days.forEach((d) => out.add(d))
    else {
      const pick = b.n > 0 ? days[b.n - 1] : days[days.length + b.n]
      if (pick) out.add(pick)
    }
  }
  return [...out]
}

function monthDays(year: number, month: number, byMonthDay: number[]): number[] {
  const dim = daysInMonth(year, month)
  return byMonthDay.map((d) => (d > 0 ? d : dim + d + 1)).filter((d) => d >= 1 && d <= dim)
}

/** 마스터 날짜를 기준으로 period 번째 주기에 들어갈 후보 날짜들(정렬됨) */
function candidates(rule: Rule, base: YMD, period: number): YMD[] {
  const days: YMD[] = []
  const inMonth = (m: number) => rule.byMonth.length === 0 || rule.byMonth.includes(m)

  if (rule.freq === "DAILY") {
    const d = addDays({ ...base, hour: 0, minute: 0, second: 0 }, period * rule.interval)
    const ok =
      inMonth(d.month) &&
      (rule.byMonthDay.length === 0 || monthDays(d.year, d.month, rule.byMonthDay).includes(d.day)) &&
      (rule.byDay.length === 0 || rule.byDay.some((b) => b.wd === weekday(d)))
    if (ok) days.push(d)
  } else if (rule.freq === "WEEKLY") {
    // 주의 시작(WKST)으로 내린 뒤 주기만큼 민다
    const back = (weekday(base) - rule.wkst + 7) % 7
    const weekStart = addDays({ ...base, hour: 0, minute: 0, second: 0 }, -back + period * rule.interval * 7)
    const wds = rule.byDay.length > 0 ? rule.byDay.map((b) => b.wd) : [weekday(base)]
    for (let i = 0; i < 7; i++) {
      const d = addDays(weekStart, i)
      if (wds.includes(weekday(d)) && inMonth(d.month)) days.push(d)
    }
  } else if (rule.freq === "MONTHLY") {
    const idx = base.month - 1 + period * rule.interval
    const year = base.year + Math.floor(idx / 12)
    const month = (idx % 12) + 1
    if (inMonth(month)) {
      let list: number[]
      if (rule.byMonthDay.length > 0) {
        list = monthDays(year, month, rule.byMonthDay)
        if (rule.byDay.length > 0) list = list.filter((d) => rule.byDay.some((b) => b.wd === weekday({ year, month, day: d })))
      } else if (rule.byDay.length > 0) list = monthDaysByWeekday(year, month, rule.byDay)
      else list = base.day <= daysInMonth(year, month) ? [base.day] : [] // 31일 반복은 31일이 없는 달을 건너뛴다
      for (const day of list) days.push({ year, month, day })
    }
  } else {
    const year = base.year + period * rule.interval
    const months = rule.byMonth.length > 0 ? rule.byMonth : [base.month]
    for (const month of months) {
      let list: number[]
      if (rule.byMonthDay.length > 0) list = monthDays(year, month, rule.byMonthDay)
      else if (rule.byDay.length > 0) {
        // BYMONTH 없이 서수 BYDAY 를 쓰면 "그 해의 n번째" 라는 뜻이 된다 — 그 꼴은 지원하지 않는다
        if (rule.byMonth.length === 0 && rule.byDay.some((b) => b.n !== null)) return []
        list = monthDaysByWeekday(year, month, rule.byDay)
      } else list = base.day <= daysInMonth(year, month) ? [base.day] : []
      for (const day of list) days.push({ year, month, day })
    }
  }
  return days.sort((a, b) => Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day))
}

export type Occurrence = {
  start: Date
  end: Date
  /** 이 회차의 원래 시각. 예외 회차(RECURRENCE-ID)를 맞출 때 쓴다 */
  key: string
}

export type ExpandInput = {
  start: Date
  end: Date
  isAllDay: boolean
  tzid: string | null
  rrule: string
  exdates: Date[]
}

/**
 * 반복 회차를 처음부터 센다. `stopAfter` 보다 늦게 시작하는 회차가 나오면 멈춘다.
 * COUNT 는 EXDATE 로 빠지는 회차까지 센다(RFC 5545) — 그래서 EXDATE 는 맨 나중에 뺀다.
 */
function* generate(input: ExpandInput, rule: Rule, stopAfter: Date): Generator<Occurrence> {
  const tz = input.isAllDay ? SEOUL : normalizeTz(input.tzid)
  const duration = input.end.getTime() - input.start.getTime()
  const master = toWall(input.start, tz)
  const excluded = new Set(input.exdates.map((d) => d.getTime()))

  let emitted = 0
  let steps = 0
  const occurrenceAt = (d: YMD) =>
    fromWall({ ...d, hour: master.hour, minute: master.minute, second: master.second } as WallTime, tz)
  const pastUntil = (d: YMD, at: Date) => {
    if (rule.until && at > rule.until) return true
    if (rule.untilDate) {
      const u = Date.UTC(rule.untilDate.year, rule.untilDate.month - 1, rule.untilDate.day)
      if (Date.UTC(d.year, d.month - 1, d.day) > u) return true
    }
    return false
  }
  const emit = function* (at: Date): Generator<Occurrence> {
    emitted++
    if (!excluded.has(at.getTime())) {
      yield { start: at, end: new Date(at.getTime() + duration), key: at.toISOString() }
    }
  }

  // DTSTART 는 규칙에 맞든 안 맞든 첫 회차다
  yield* emit(input.start)

  for (let period = 0; steps < MAX_STEPS; period++) {
    const list = candidates(rule, master, period)
    steps++
    for (const d of list) {
      const at = occurrenceAt(d)
      if (at.getTime() <= input.start.getTime()) continue
      if (pastUntil(d, at)) return
      if (rule.count !== null && emitted >= rule.count) return
      if (at > stopAfter) return
      yield* emit(at)
    }
    if (rule.count !== null && emitted >= rule.count) return
    // 주기 하나가 통째로 비어도(31일이 없는 달) 다음 주기로 간다. 다만 주기 시작이 넘으면 멈춘다
    if (list.length > 0 && occurrenceAt(list[0]) > stopAfter) return
    if (list.length === 0 && period > 0 && period * rule.interval > 400 * 12) return
  }
}

/**
 * [from, until) 창과 겹치는 회차들. 규칙을 못 읽으면 `null` — 부르는 쪽이 마스터만 그린다.
 */
export function expandOccurrences(input: ExpandInput, from: Date, until: Date): Occurrence[] | null {
  const rule = parseRRule(input.rrule)
  if (!rule) return null
  const out: Occurrence[] = []
  for (const occ of generate(input, rule, until)) {
    if (occ.end > from && occ.start < until) out.push(occ)
    // 길이 0 인 일정은 시작이 창 안이면 넣는다
    else if (occ.start.getTime() === occ.end.getTime() && occ.start >= from && occ.start < until) out.push(occ)
  }
  return out
}

/**
 * 반복의 마지막 회차가 끝나는 시각. 끝이 없으면(COUNT · UNTIL 없음) `null`.
 * 규칙을 못 읽으면 마스터의 끝 — 그때는 마스터 한 번만 그리기 때문이다.
 * DB 의 `recurUntil` 이 이 값이고, 조회 창을 거를 때 쓴다.
 */
export function recurrenceEnd(input: ExpandInput): Date | null {
  const rule = parseRRule(input.rrule)
  if (!rule) return input.end
  if (rule.count === null && !rule.until && !rule.untilDate) return null
  let last: Occurrence | null = null
  const horizon = new Date(Date.UTC(9999, 0, 1))
  for (const occ of generate({ ...input, exdates: [] }, rule, horizon)) last = occ
  return last ? last.end : input.end
}
