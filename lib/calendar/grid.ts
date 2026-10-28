/**
 * 월 보기의 칸 계산. 서울 날짜로 센다 — 브라우저 시간대가 어디든 회사 달력은 서울이다.
 * 클라이언트에서도 쓴다(Intl 만 쓴다).
 */

import { SEOUL, addDays, fromWall, seoulDateKey, toWall, weekday } from "@/lib/calendar/time"
import type { CalendarItem } from "@/lib/calendar/types"

const DAY_MS = 86_400_000

export type GridDay = {
  /** "YYYY-MM-DD" (서울) */
  key: string
  day: number
  /** 이 칸의 서울 자정 */
  start: Date
  inMonth: boolean
  /** 0=일 … 6=토 */
  weekday: number
}

/** 일요일부터 6주(42칸). 네이버 캘린더와 같은 시작 요일이다 */
export function monthGrid(year: number, month: number): GridDay[] {
  const first = { year, month, day: 1, hour: 0, minute: 0, second: 0 }
  const lead = weekday(first)
  const days: GridDay[] = []
  for (let i = 0; i < 42; i++) {
    const w = addDays(first, i - lead)
    const start = fromWall(w, SEOUL)
    days.push({ key: seoulDateKey(start), day: w.day, start, inMonth: w.month === month, weekday: i % 7 })
  }
  return days
}

/** 칸 전체의 조회 창 [첫 칸 자정, 마지막 칸 다음 자정) */
export function gridWindow(days: GridDay[]): { from: Date; until: Date } {
  return { from: days[0].start, until: new Date(days[days.length - 1].start.getTime() + DAY_MS) }
}

/** 일정의 첫날과 마지막 날(서울). 끝은 포함하지 않는다 — 자정에 끝나는 일정은 그 전날까지 */
export function itemSpan(item: Pick<CalendarItem, "start" | "end">): { first: string; last: string } {
  const start = new Date(item.start)
  const end = new Date(item.end)
  const lastInstant = end > start ? new Date(end.getTime() - 1) : start
  return { first: seoulDateKey(start), last: seoulDateKey(lastInstant) }
}

/** 그 날이 일정 기간 안인가. 날짜 키는 "YYYY-MM-DD" 라 글자 비교가 곧 날짜 비교다 */
export function coversDay(item: Pick<CalendarItem, "start" | "end">, key: string): boolean {
  const { first, last } = itemSpan(item)
  return first <= key && key <= last
}

/**
 * 일정이 걸치는 서울 날짜들 — 칸에 나눠 담을 때 쓴다. 칸에 담는 것은 일주일 이하뿐이라
 * 400일에서 끊는다. 긴 기간의 끝을 알아야 하면 `itemSpan` 을 쓴다(여기서 세면 잘린다)
 */
export function itemDayKeys(item: Pick<CalendarItem, "start" | "end">): string[] {
  const { last: lastKey } = itemSpan(item)
  const keys: string[] = []
  let w = toWall(new Date(item.start), SEOUL)
  for (let i = 0; i < 400; i++) {
    const key = `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`
    keys.push(key)
    if (key >= lastKey) break
    w = addDays(w, 1)
  }
  return keys
}

/** 이 길이를 넘는 기간(지원사업 · 프로젝트)은 칸마다 그리지 않고 위 띠에 모은다 */
export const LONG_SPAN_DAYS = 7

export function isLongSpan(item: Pick<CalendarItem, "start" | "end">): boolean {
  return itemDayKeys(item).length > LONG_SPAN_DAYS
}

/** "10월 1일 – 12월 31일", 해를 넘으면 "2025년 4월 1일 – 2026년 12월 31일" */
export function spanLabel(item: Pick<CalendarItem, "start" | "end">): string {
  const { first, last } = itemSpan(item)
  const [y1, m1, d1] = first.split("-").map(Number)
  const [y2, m2, d2] = last.split("-").map(Number)
  if (first === last) return `${m1}월 ${d1}일`
  return y1 === y2 ? `${m1}월 ${d1}일 – ${m2}월 ${d2}일` : `${y1}년 ${m1}월 ${d1}일 – ${y2}년 ${m2}월 ${d2}일`
}

/** "오후 2:08" — 채팅과 같은 꼴 (ux-rules 「시간」) */
export function timeLabel(iso: string): string {
  const w = toWall(new Date(iso), SEOUL)
  const ampm = w.hour < 12 ? "오전" : "오후"
  const h = w.hour % 12 === 0 ? 12 : w.hour % 12
  return `${ampm} ${h}:${String(w.minute).padStart(2, "0")}`
}

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`
}

export function parseMonthKey(s: string | null | undefined): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(s ?? "")
  if (!m) return null
  const month = Number(m[2])
  return month >= 1 && month <= 12 ? { year: Number(m[1]), month } : null
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + delta
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 }
}

export function thisSeoulMonth(now = new Date()): { year: number; month: number } {
  const w = toWall(now, SEOUL)
  return { year: w.year, month: w.month }
}

export function todayKey(now = new Date()): string {
  return seoulDateKey(now)
}
