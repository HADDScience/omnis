/**
 * 에이전트 · MCP 읽기 도구 list_calendar — 웍스 캘린더 일정을 기간으로 읽어 글로 돌려준다.
 *
 * 읽기는 캘린더 탭 API(app/api/calendar)와 **같은 함수** getCalendarItems 를 부른다. 그래서
 * - 보이는 캘린더: 관리자는 전부, 나머지는 관리자가 연(audience ALL) 캘린더만 (items.ts visibleCalendarFilter)
 * - 반복 · EXDATE · 예외 회차 · CANCELLED 처리: works.ts worksItems 그대로
 * 가 화면과 같다. 화면처럼 설명(description)은 싣지 않고, 참석자 · 주최자도 싣지 않는다(화면에 없다).
 * 비공개(CLASS:PRIVATE)는 동기화가 저장하지 않아 화면도 가리지 않는다 — 여기도 같다.
 *
 * 읽기 전에 캘린더 탭을 열 때처럼 웍스를 한 번 당긴다(syncWorksCalendars — 60초에 한 번 · 겹치면 하나로).
 * 웍스가 늦거나 실패하면 SYNC_WAIT_MS 만 기다리고 저장해 둔 것으로 답한다. 캘린더마다 마지막 동기화 시각을 붙여
 * 모델이 「웍스와 최대 N시간 차이」 를 말할 수 있게 한다. mydocs/working/2026-10-30-omnis-calendar-read.md
 */

import { syncWorksCalendars } from "@/lib/caldav/sync"
import { getCalendarItems, type CalendarQuery } from "@/lib/calendar/items"
import { SEOUL, addDays, dayDiff, seoulMidnight, toWall, weekday, type WallTime } from "@/lib/calendar/time"
import type { CalendarItem, CalendarResponse } from "@/lib/calendar/types"
import { CalendarToolArgsSchema, type CalendarToolArgs } from "@/lib/schemas/calendar"

/** 기본 창 — 오늘부터 7일 */
export const CALENDAR_TOOL_DEFAULT_DAYS = 7
/** 한 번에 볼 수 있는 날 수. 두 달 남짓 — 「이번 달」「다음 달」 을 한 번에 */
export const CALENDAR_TOOL_MAX_DAYS = 62
/** 돌려주는 회차 수 상한. 넘으면 잘렸다고 적는다 */
export const CALENDAR_TOOL_MAX_ITEMS = 100

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"]
const pad = (n: number) => String(n).padStart(2, "0")
const dateKey = (w: Pick<WallTime, "year" | "month" | "day">) => `${w.year}-${pad(w.month)}-${pad(w.day)}`
const dayLabel = (w: Pick<WallTime, "year" | "month" | "day">) => `${dateKey(w)}(${WEEKDAY[weekday(w)]})`
const hm = (w: WallTime) => `${pad(w.hour)}:${pad(w.minute)}`
const wallOfKey = (s: string): WallTime => {
  const [year, month, day] = s.split("-").map(Number)
  return { year, month, day, hour: 0, minute: 0, second: 0 }
}

export type CalendarWindow = {
  from: Date
  /** 끝(포함하지 않음) — to 날짜 다음 서울 자정 */
  until: Date
  fromDay: WallTime
  toDay: WallTime
  today: WallTime
  /** 상한에 걸려 to 를 줄였으면 원래 요청한 to */
  clampedFrom?: string
}

/** from · to(서울 날짜, to 포함) → 조회 창. 기본은 오늘부터 7일, 최대 62일 */
export function calendarToolWindow(args: CalendarToolArgs, now: Date): CalendarWindow | { error: string } {
  const w = toWall(now, SEOUL)
  const today: WallTime = { ...w, hour: 0, minute: 0, second: 0 }
  const fromDay = args.from ? wallOfKey(args.from) : today
  let toDay = args.to ? wallOfKey(args.to) : addDays(fromDay, CALENDAR_TOOL_DEFAULT_DAYS - 1)
  const span = dayDiff(fromDay, toDay)
  if (span < 0) return { error: `to(${dateKey(toDay)}) 가 from(${dateKey(fromDay)}) 보다 앞입니다.` }
  let clampedFrom: string | undefined
  if (span + 1 > CALENDAR_TOOL_MAX_DAYS) {
    clampedFrom = dateKey(toDay)
    toDay = addDays(fromDay, CALENDAR_TOOL_MAX_DAYS - 1)
  }
  const next = addDays(toDay, 1)
  return {
    from: seoulMidnight(fromDay.year, fromDay.month, fromDay.day),
    until: seoulMidnight(next.year, next.month, next.day),
    fromDay,
    toDay,
    today,
    ...(clampedFrom ? { clampedFrom } : {}),
  }
}

function whenLabel(i: CalendarItem): string {
  const s = toWall(new Date(i.start), SEOUL)
  if (i.allDay) {
    // 종일의 끝은 마지막 날 다음 자정이다
    const last = toWall(new Date(new Date(i.end).getTime() - 1), SEOUL)
    return dateKey(last) === dateKey(s) ? `${dayLabel(s)} 종일` : `${dayLabel(s)} ~ ${dayLabel(last)} 종일`
  }
  const e = toWall(new Date(i.end), SEOUL)
  if (i.end === i.start) return `${dayLabel(s)} ${hm(s)}`
  return dateKey(e) === dateKey(s) ? `${dayLabel(s)} ${hm(s)}–${hm(e)}` : `${dayLabel(s)} ${hm(s)} – ${dayLabel(e)} ${hm(e)}`
}

function itemLine(i: CalendarItem): string {
  return [
    `- ${whenLabel(i)}`,
    i.title,
    `[${i.tag}]`,
    ...(i.location ? [`장소 ${i.location}`] : []),
    ...(i.recurring ? ["반복"] : []),
    ...(i.muted ? ["미정"] : []),
  ].join(" · ")
}

const seoulStamp = (iso: string) => {
  const w = toWall(new Date(iso), SEOUL)
  return `${dateKey(w)} ${hm(w)}`
}

/** 받은 캘린더 응답을 도구 결과 글로. DB 를 부르지 않는다 */
export function calendarToolText(data: CalendarResponse, win: CalendarWindow, args: CalendarToolArgs, now: Date): string {
  if (data.calendars.length === 0) {
    return "볼 수 있는 웍스 캘린더가 없습니다 — 웍스 연동이 설정돼 있지 않거나, 관리자가 캘린더 화면에서 캘린더를 구성원 전체에 열지 않았습니다."
  }
  const want = args.calendar?.toLowerCase()
  const picked = want ? data.calendars.filter((c) => c.displayName.toLowerCase().includes(want)) : data.calendars
  if (picked.length === 0) {
    return `'${args.calendar}' 에 맞는 캘린더가 없습니다. 볼 수 있는 캘린더: ${data.calendars.map((c) => c.displayName).join(", ")}`
  }

  const ids = new Set(picked.map((c) => c.id))
  const words = (args.query ?? "").toLowerCase().split(/\s+/).filter(Boolean)
  const items = data.items
    .filter((i) => i.group === "works" && i.calendarId !== undefined && ids.has(i.calendarId))
    .filter((i) => args.all_day === undefined || i.allDay === args.all_day)
    .filter((i) => words.every((w) => `${i.title} ${i.location ?? ""}`.toLowerCase().includes(w)))
  const shown = items.slice(0, CALENDAR_TOOL_MAX_ITEMS)

  const conds = [
    ...(want ? [`캘린더 '${args.calendar}'`] : []),
    ...(words.length ? [`검색어 '${args.query}'`] : []),
    ...(args.all_day === true ? ["종일만"] : args.all_day === false ? ["시간 있는 일정만"] : []),
  ]
  const head = [
    `웍스 일정 ${dayLabel(win.fromDay)} ~ ${dayLabel(win.toDay)} (Asia/Seoul) · ${items.length}건${conds.length ? ` · ${conds.join(" · ")}` : ""}`,
    `오늘: ${dayLabel(win.today)} (Asia/Seoul)`,
  ]
  if (win.clampedFrom) {
    head.push(`요청한 끝 ${win.clampedFrom} 은 한 번에 ${CALENDAR_TOOL_MAX_DAYS}일을 넘어 ${dateKey(win.toDay)} 까지만 읽었다. 그 뒤는 from 을 옮겨 다시 부른다.`)
  }

  // 동기화 — 가장 오래된 캘린더가 웍스와 벌어질 수 있는 최대 시간
  const synced = picked.map((c) => `${c.displayName} ${c.syncedAt ? seoulStamp(c.syncedAt) : "동기화 기록 없음"}`)
  const times = picked.map((c) => (c.syncedAt ? new Date(c.syncedAt).getTime() : null))
  if (times.some((t) => t === null)) {
    head.push(`마지막 동기화: ${synced.join(" · ")} — 한 번도 동기화되지 않은 캘린더는 일정이 비어 보일 수 있다.`)
  } else {
    const hours = Math.max(0, Math.ceil((now.getTime() - Math.min(...(times as number[]))) / 3_600_000))
    head.push(
      `마지막 동기화: ${synced.join(" · ")} — 웍스 원본과 최대 약 ${hours <= 1 ? "1시간" : `${hours}시간`} 차이가 날 수 있다(그 뒤 웍스에서 바뀐 일정은 아직 안 보인다).`
    )
  }

  const body = shown.length ? shown.map(itemLine) : ["이 기간 · 조건에 맞는 일정이 없습니다."]
  const tail =
    items.length > shown.length
      ? [`… ${items.length}건 중 앞 ${shown.length}건만 보였다(잘림). 기간을 줄이거나 calendar · query · all_day 로 좁혀 다시 부른다.`]
      : []
  return [...head, "", ...body, ...tail].join("\n")
}

export type CalendarLoader = (q: CalendarQuery) => Promise<CalendarResponse>

/** 읽기 전 웍스 동기화를 기다리는 최대 시간. 넘으면 동기화는 뒤에서 마저 돌고 저장해 둔 것으로 답한다 */
export const SYNC_WAIT_MS = 8_000

/** 웍스를 당긴다 — 실패 · 시간 초과는 삼킨다(답은 저장해 둔 것과 마지막 동기화 시각으로) */
async function syncBeforeRead(sync: () => Promise<unknown>, waitMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, waitMs)
  })
  try {
    await Promise.race([sync().catch((err) => console.error("[list_calendar sync]", err)), timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** 도구 실행 — 입력 검증(Zod) → 창 → 웍스 동기화 → 캘린더 탭과 같은 getCalendarItems → 글 */
export async function listCalendarText(
  rawArgs: unknown,
  viewer: CalendarQuery["viewer"],
  opts: { now?: Date; load?: CalendarLoader; sync?: () => Promise<unknown>; syncWaitMs?: number } = {}
): Promise<{ text: string } | { error: string }> {
  const parsed = CalendarToolArgsSchema.safeParse(rawArgs ?? {})
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => `${i.path.join(".") || "입력"}: ${i.message}`).join(" · ") }
  }
  const now = opts.now ?? new Date()
  const win = calendarToolWindow(parsed.data, now)
  if ("error" in win) return win
  // 시험(load 를 넘긴 경우)은 웍스로 나가지 않는다
  const sync = opts.sync ?? (opts.load ? null : () => syncWorksCalendars())
  if (sync) await syncBeforeRead(sync, opts.syncWaitMs ?? SYNC_WAIT_MS)
  const data = await (opts.load ?? getCalendarItems)({ from: win.from, until: win.until, groups: ["works"], viewer, taskScope: "mine" })
  return { text: calendarToolText(data, win, parsed.data, now) }
}
