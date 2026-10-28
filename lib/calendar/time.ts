/**
 * 캘린더의 시간대 계산.
 *
 * 회사 시간대는 서울이다. 웍스 일정도 거의 다 `DTSTART;TZID=Asia/Seoul` 로 오지만 다른 TZID 가
 * 섞일 수 있어 Intl 로 오프셋을 구한다. 서울은 서머타임이 없어 대부분 +09:00 이다.
 * mydocs/tech/calendar.md 1.2 「반복 일정」.
 */

export const SEOUL = "Asia/Seoul"

const DAY_MS = 86_400_000

export type WallTime = {
  year: number
  /** 1~12 */
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const formatters = new Map<string, Intl.DateTimeFormat>()

/** 알 수 없는 TZID(윈도 이름 같은)는 서울로 본다. 회사 일정이 서울 밖에서 만들어질 일은 드물다. */
export function normalizeTz(tz: string | null | undefined): string {
  if (!tz) return SEOUL
  if (formatters.has(tz)) return tz
  try {
    formatters.set(
      tz,
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
      })
    )
    return tz
  } catch {
    return SEOUL
  }
}

/** UTC 순간을 그 시간대의 벽시계 시각으로 */
export function toWall(instant: Date, tz: string): WallTime {
  const zone = normalizeTz(tz)
  const parts = formatters.get(zone)!.formatToParts(instant)
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value)
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  }
}

function offsetMs(utcMs: number, tz: string): number {
  const w = toWall(new Date(utcMs), tz)
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - utcMs
}

/** 그 시간대의 벽시계 시각을 UTC 순간으로. 오프셋이 바뀌는 경계는 한 번 더 맞춘다 */
export function fromWall(w: WallTime, tz: string): Date {
  const zone = normalizeTz(tz)
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second)
  const first = offsetMs(asUtc, zone)
  let t = asUtc - first
  const second = offsetMs(t, zone)
  if (second !== first) t = asUtc - second
  return new Date(t)
}

/** 날짜 칸을 더한다. 월말·윤년은 Date.UTC 가 넘겨 준다 */
export function addDays(w: WallTime, days: number): WallTime {
  const d = new Date(Date.UTC(w.year, w.month - 1, w.day + days))
  return { ...w, year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

/** 0=일 … 6=토 */
export function weekday(w: Pick<WallTime, "year" | "month" | "day">): number {
  return new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay()
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** 두 날짜 사이의 일수 (b - a). 시각은 무시한다 */
export function dayDiff(
  a: Pick<WallTime, "year" | "month" | "day">,
  b: Pick<WallTime, "year" | "month" | "day">
): number {
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / DAY_MS)
}

/** 서울 날짜의 자정 (종일 일정의 기준점) */
export function seoulMidnight(year: number, month: number, day: number): Date {
  return fromWall({ year, month, day, hour: 0, minute: 0, second: 0 }, SEOUL)
}

/** 서울 기준 그 날의 자정 */
export function seoulDayStart(instant: Date): Date {
  const w = toWall(instant, SEOUL)
  return seoulMidnight(w.year, w.month, w.day)
}

/** "YYYY-MM-DD" (서울) */
export function seoulDateKey(instant: Date): string {
  const w = toWall(instant, SEOUL)
  return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`
}
