"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { format } from "date-fns"
// date-fns 의 ko 가 아니라 DayPicker 의 ko — 드롭다운 · 이동 버튼의 화면낭독 이름까지 한국어다
import { ko } from "react-day-picker/locale"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown01Icon, ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { useVisibleInterval } from "@/hooks/use-visible-interval"
import {
  type GridDay,
  coversDay,
  gridWindow,
  isLongSpan,
  itemDayKeys,
  monthGrid,
  monthKey,
  parseMonthKey,
  shiftMonth,
  thisSeoulMonth,
  todayKey,
} from "@/lib/calendar/grid"
import { CALENDAR_GROUPS, type CalendarGroup, type CalendarItem, type CalendarResponse } from "@/lib/calendar/types"
import { CalendarFilters } from "./calendar-filters"
import { DayAgenda } from "./day-agenda"
import { LongSpans } from "./long-spans"
import { toneOf } from "./tones"

export type CalendarPrefs = {
  groups: CalendarGroup[]
  /** 끈 웍스 캘린더 id */
  hiddenCalendars: string[]
  taskScope: "mine" | "all"
}

const PREFS_KEY = "omnis.calendar.prefs.v1"
const DEFAULT_PREFS: CalendarPrefs = {
  groups: CALENDAR_GROUPS.filter((g) => g.defaultOn).map((g) => g.key),
  hiddenCalendars: [],
  taskScope: "mine",
}

/** 켜고 끈 것은 이 브라우저에만 남긴다. 저장소가 막혀 있어도(사생활 보호 창) 화면은 돈다 */
function readPrefs(): CalendarPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY)
    if (!raw) return DEFAULT_PREFS
    const p = JSON.parse(raw) as Partial<CalendarPrefs>
    const known = new Set<string>(CALENDAR_GROUPS.map((g) => g.key))
    return {
      groups: Array.isArray(p.groups) ? p.groups.filter((g): g is CalendarGroup => known.has(g)) : DEFAULT_PREFS.groups,
      hiddenCalendars: Array.isArray(p.hiddenCalendars) ? p.hiddenCalendars.filter((x) => typeof x === "string") : [],
      taskScope: p.taskScope === "all" ? "all" : "mine",
    }
  } catch {
    return DEFAULT_PREFS
  }
}

function writePrefs(p: CalendarPrefs) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  } catch {
    // 저장이 안 돼도 이번 화면에서는 그대로 쓴다
  }
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"]

/** 웍스 동기화 간격. 서버도 60초 안의 재시도는 요청 없이 돌려보낸다 */
const SYNC_MS = 60_000

export function CalendarView({ isAdmin, initialMonth }: { isAdmin: boolean; initialMonth: string | null }) {
  const [ym, setYm] = useState(() => parseMonthKey(initialMonth) ?? thisSeoulMonth())
  const days = useMemo(() => monthGrid(ym.year, ym.month), [ym])
  const range = useMemo(() => gridWindow(days), [days])

  const [prefs, setPrefsState] = useState<CalendarPrefs>(DEFAULT_PREFS)
  const [prefsReady, setPrefsReady] = useState(false)
  useEffect(() => {
    setPrefsState(readPrefs())
    setPrefsReady(true)
  }, [])
  const setPrefs = useCallback((next: CalendarPrefs) => {
    setPrefsState(next)
    writePrefs(next)
  }, [])

  const [data, setData] = useState<CalendarResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [selected, setSelected] = useState<string>(() => defaultDay(ym.year, ym.month))

  // 마지막 요청만 반영한다 — 달을 빠르게 넘기면 앞의 응답이 늦게 와서 덮을 수 있다
  const seq = useRef(0)
  const load = useCallback(async () => {
    const mine = ++seq.current
    setLoading(true)
    try {
      const qs = new URLSearchParams({
        from: range.from.toISOString(),
        until: range.until.toISOString(),
        groups: prefs.groups.join(","),
        taskScope: prefs.taskScope,
      })
      const res = await fetch(`/api/calendar?${qs}`, { cache: "no-store" })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`)
      const json = (await res.json()) as CalendarResponse
      if (mine !== seq.current) return
      setData(json)
      setError(null)
    } catch (err) {
      if (mine !== seq.current) return
      const message = err instanceof Error ? err.message : "불러오지 못했습니다"
      setError(message)
      toast.error(`캘린더를 불러오지 못했습니다 — ${message}`)
    } finally {
      if (mine === seq.current) setLoading(false)
    }
  }, [range, prefs.groups, prefs.taskScope])

  useEffect(() => {
    if (prefsReady) load()
  }, [load, prefsReady])

  // 웍스에서 당겨 오고, 바뀐 것이 있으면 다시 읽는다. 실패해도 화면은 DB 에 있는 것으로 그대로 보인다
  const worksConfigured = data?.worksConfigured ?? false
  const sync = useCallback(async () => {
    setSyncing(true)
    try {
      const res = await fetch("/api/calendar/sync", { method: "POST" })
      if (!res.ok) return
      const json = (await res.json()) as { changed: number; status: string }
      if (json.changed > 0) await load()
    } catch {
      // 배경 동기화 실패는 조용히 — 다음 주기에 다시 한다 (ux-rules 29 예외)
    } finally {
      setSyncing(false)
    }
  }, [load])

  const syncedMonth = useRef<string | null>(null)
  useEffect(() => {
    const key = monthKey(ym.year, ym.month)
    if (!worksConfigured || syncedMonth.current === key) return
    syncedMonth.current = key
    sync()
  }, [worksConfigured, ym, sync])
  useVisibleInterval(sync, SYNC_MS, worksConfigured)

  /** 그 달로 옮기고 그 날을 고른다. 날을 안 주면 이번 달은 오늘, 다른 달은 1일 */
  const goTo = useCallback((next: { year: number; month: number }, day?: string) => {
    // 같은 달이면 객체를 바꾸지 않는다 — 바꾸면 달 범위가 새로 잡혀 같은 달을 다시 읽는다
    setYm((prev) => (prev.year === next.year && prev.month === next.month ? prev : next))
    setSelected(day ?? defaultDay(next.year, next.month))
    try {
      window.history.replaceState(null, "", `?month=${monthKey(next.year, next.month)}`)
    } catch {
      // 주소를 못 바꿔도 화면은 바뀐다
    }
  }, [])
  const goMonth = useCallback((next: { year: number; month: number }) => goTo(next), [goTo])

  // 달력 창에서 고른 날로 바로 — 몇 해 전이라도 화살표를 여러 번 누르지 않게
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickDate = useCallback(
    (date: Date | undefined) => {
      if (!date) return
      setPickerOpen(false)
      // 달력의 Date 는 브라우저 시각 자정이다. 고른 칸의 연·월·일을 그대로 쓴다
      goTo({ year: date.getFullYear(), month: date.getMonth() + 1 }, format(date, "yyyy-MM-dd"))
    },
    [goTo]
  )

  const calendarOrder = useMemo(() => (data?.calendars ?? []).map((c) => c.id), [data])
  const visible = useMemo(() => {
    const hidden = new Set(prefs.hiddenCalendars)
    return (data?.items ?? []).filter((i) => !(i.group === "works" && i.calendarId && hidden.has(i.calendarId)))
  }, [data, prefs.hiddenCalendars])

  const { byDay, long } = useMemo(() => {
    const byDay = new Map<string, CalendarItem[]>()
    const long: CalendarItem[] = []
    for (const item of visible) {
      if (isLongSpan(item)) {
        long.push(item)
        continue
      }
      for (const key of itemDayKeys(item)) byDay.set(key, [...(byDay.get(key) ?? []), item])
    }
    for (const list of byDay.values()) list.sort(byTime)
    return { byDay, long }
  }, [visible])

  const selectedItems = byDay.get(selected) ?? []
  const selectedLong = long.filter((i) => coversDay(i, selected))
  const today = todayKey()

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-4 sm:px-6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            className="touch-target"
            aria-label="이전 달"
            onClick={() => goMonth(shiftMonth(ym.year, ym.month, -1))}
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} size={16} />
          </Button>
          <h1 className="text-[17px] font-bold tracking-[-0.02em]" aria-live="polite">
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    aria-label={`${ym.year}년 ${ym.month}월 — 날짜로 이동`}
                    title="날짜로 이동"
                    className="touch-target flex min-w-[7.5em] items-center justify-center gap-1 rounded-md px-1.5 tabular-nums transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  />
                }
              >
                {ym.year}년 {ym.month}월
                <HugeiconsIcon icon={ArrowDown01Icon} size={14} aria-hidden className="text-muted-foreground" />
              </PopoverTrigger>
              <PopoverContent align="start" side="bottom" className="w-auto p-0">
                <Calendar
                  mode="single"
                  locale={ko}
                  captionLayout="dropdown"
                  startMonth={new Date(PICKER_FIRST_YEAR, 0)}
                  endMonth={new Date(new Date().getFullYear() + PICKER_YEARS_AHEAD, 11)}
                  defaultMonth={new Date(ym.year, ym.month - 1)}
                  selected={dateOfKey(selected)}
                  onSelect={pickDate}
                />
              </PopoverContent>
            </Popover>
          </h1>
          <Button
            variant="ghost"
            size="icon-sm"
            className="touch-target"
            aria-label="다음 달"
            onClick={() => goMonth(shiftMonth(ym.year, ym.month, 1))}
          >
            <HugeiconsIcon icon={ArrowRight01Icon} size={16} />
          </Button>
        </div>
        <Button variant="outline" size="sm" className="touch-target" onClick={() => goMonth(thisSeoulMonth())}>
          오늘
        </Button>
        {(loading || syncing) && (
          <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground" role="status">
            <Spinner className="size-3.5" />
            {syncing ? "웍스 확인 중" : "불러오는 중"}
          </span>
        )}
        <div className="ml-auto">
          <CalendarFilters prefs={prefs} onChange={setPrefs} data={data} isAdmin={isAdmin} onAudienceChanged={load} />
        </div>
      </div>

      {error && !data && (
        <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 px-3 py-2 text-[13px]">
          캘린더를 불러오지 못했습니다 — {error}
          <Button size="sm" variant="outline" className="touch-target" onClick={() => load()}>
            다시 시도
          </Button>
        </div>
      )}

      {long.length > 0 && <LongSpans items={long} calendarOrder={calendarOrder} />}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section aria-label={`${ym.year}년 ${ym.month}월`} className="min-w-0">
          <div className="grid grid-cols-7 border-b pb-1 text-center text-[11.5px] font-medium text-muted-foreground" aria-hidden>
            {WEEKDAYS.map((w, i) => (
              <div key={w} className={i === 0 ? "text-rose-600 dark:text-rose-400" : i === 6 ? "text-sky-700 dark:text-sky-400" : ""}>
                {w}
              </div>
            ))}
          </div>
          {!data && loading ? (
            <div className="grid grid-cols-7 gap-px pt-px">
              {days.map((d) => (
                <Skeleton key={d.key} className="h-[52px] rounded-none sm:h-[96px]" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-7 border-l" role="group" aria-label="날짜를 고르면 아래에 그날 일정이 나온다">
              {days.map((d) => (
                <DayCell
                  key={d.key}
                  day={d}
                  items={byDay.get(d.key) ?? []}
                  isToday={d.key === today}
                  isSelected={d.key === selected}
                  onSelect={() => setSelected(d.key)}
                  calendarOrder={calendarOrder}
                />
              ))}
            </div>
          )}
        </section>

        <DayAgenda dateKey={selected} items={selectedItems} longItems={selectedLong} calendarOrder={calendarOrder} />
      </div>
    </div>
  )
}

/** 날짜 고르기 창의 연도 범위. 회사 기록(연혁)이 창업 무렵부터 있다 */
const PICKER_FIRST_YEAR = 2015
const PICKER_YEARS_AHEAD = 3

/** "YYYY-MM-DD" → 브라우저 시각 자정의 Date (달력 컴포넌트가 쓰는 꼴) */
function dateOfKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number)
  return new Date(y, m - 1, d)
}

/** 그 달을 열었을 때 처음 고를 날 — 이번 달이면 오늘, 아니면 1일 */
function defaultDay(year: number, month: number) {
  const today = todayKey()
  return today.startsWith(monthKey(year, month)) ? today : `${monthKey(year, month)}-01`
}

function byTime(a: CalendarItem, b: CalendarItem) {
  return Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start) || a.title.localeCompare(b.title)
}

const MAX_CHIPS = 3

function DayCell({
  day,
  items,
  isToday,
  isSelected,
  onSelect,
  calendarOrder,
}: {
  day: GridDay
  items: CalendarItem[]
  isToday: boolean
  isSelected: boolean
  onSelect: () => void
  calendarOrder: string[]
}) {
  const label = `${day.key.slice(5, 7).replace(/^0/, "")}월 ${day.day}일, 일정 ${items.length}건`
  return (
    <button
      type="button"
      aria-pressed={isSelected}
      aria-current={isToday ? "date" : undefined}
      aria-label={label}
      onClick={onSelect}
      className={`flex min-h-[52px] min-w-0 flex-col items-stretch gap-0.5 border-r border-b p-1 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring sm:min-h-[96px] ${
        day.inMonth ? "" : "bg-muted/30 text-muted-foreground"
      } ${isSelected ? "bg-primary/[0.06] ring-1 ring-inset ring-primary/40" : ""}`}
    >
      <span
        className={`flex size-6 items-center justify-center self-center rounded-full text-[12px] tabular-nums sm:self-start ${
          isToday ? "bg-primary font-semibold text-primary-foreground" : day.weekday === 0 ? "text-rose-600 dark:text-rose-400" : ""
        }`}
      >
        {day.day}
      </span>

      {/* 좁은 화면 — 점만. 누르면 아래 목록에 그날이 나온다 */}
      <span className="flex flex-wrap justify-center gap-0.5 sm:hidden" aria-hidden>
        {items.slice(0, 4).map((i) => (
          <span key={i.id} className={`size-1.5 rounded-full ${toneOf(i, calendarOrder).dot} ${i.muted ? "opacity-40" : ""}`} />
        ))}
      </span>

      {/* 넓은 화면 — 제목 칩 셋까지 */}
      <span className="hidden min-w-0 flex-col gap-0.5 sm:flex" aria-hidden>
        {items.slice(0, MAX_CHIPS).map((i) => {
          const tone = toneOf(i, calendarOrder)
          return (
            <span
              key={i.id}
              className={`truncate rounded-[3px] border-l-2 px-1 py-px text-[11px] leading-tight ${tone.chip} ${tone.bar} ${
                i.muted ? "opacity-50 line-through decoration-1" : ""
              }`}
            >
              {i.title}
            </span>
          )
        })}
        {items.length > MAX_CHIPS && (
          <span className="px-1 text-[10.5px] text-muted-foreground">+{items.length - MAX_CHIPS}건 더</span>
        )}
      </span>
    </button>
  )
}
