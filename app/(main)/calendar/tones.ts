import type { CalendarGroup, CalendarItem } from "@/lib/calendar/types"

/**
 * 출처별 색. Tailwind 가 클래스를 찾을 수 있게 문자열을 통째로 적는다(조립하지 않는다).
 * 다크모드는 글자색만 밝게 바꾼다 — 배경은 반투명이라 양쪽에서 읽힌다.
 */
export type Tone = { dot: string; chip: string; bar: string }

const T = {
  sky: { dot: "bg-sky-500", chip: "bg-sky-500/12 text-sky-900 dark:text-sky-100", bar: "border-l-sky-500" },
  violet: { dot: "bg-violet-500", chip: "bg-violet-500/12 text-violet-900 dark:text-violet-100", bar: "border-l-violet-500" },
  amber: { dot: "bg-amber-500", chip: "bg-amber-500/15 text-amber-900 dark:text-amber-100", bar: "border-l-amber-500" },
  cyan: { dot: "bg-cyan-500", chip: "bg-cyan-500/12 text-cyan-900 dark:text-cyan-100", bar: "border-l-cyan-500" },
  fuchsia: { dot: "bg-fuchsia-500", chip: "bg-fuchsia-500/12 text-fuchsia-900 dark:text-fuchsia-100", bar: "border-l-fuchsia-500" },
  rose: { dot: "bg-rose-500", chip: "bg-rose-500/12 text-rose-900 dark:text-rose-100", bar: "border-l-rose-500" },
  emerald: { dot: "bg-emerald-500", chip: "bg-emerald-500/12 text-emerald-900 dark:text-emerald-100", bar: "border-l-emerald-500" },
  indigo: { dot: "bg-indigo-500", chip: "bg-indigo-500/12 text-indigo-900 dark:text-indigo-100", bar: "border-l-indigo-500" },
  orange: { dot: "bg-orange-500", chip: "bg-orange-500/12 text-orange-900 dark:text-orange-100", bar: "border-l-orange-500" },
  teal: { dot: "bg-teal-500", chip: "bg-teal-500/12 text-teal-900 dark:text-teal-100", bar: "border-l-teal-500" },
  slate: { dot: "bg-slate-500", chip: "bg-slate-500/12 text-slate-900 dark:text-slate-100", bar: "border-l-slate-500" },
} satisfies Record<string, Tone>

const GROUP_TONE: Record<Exclude<CalendarGroup, "works">, Tone> = {
  tasks: T.rose,
  projects: T.emerald,
  records: T.indigo,
  crm: T.orange,
  finance: T.teal,
  reports: T.slate,
}

const WORKS_TONES: Tone[] = [T.sky, T.violet, T.amber, T.cyan, T.fuchsia]

/** 웍스 캘린더는 캘린더마다 색이 다르다 — 이름순 자리로 고른다 */
export function toneOf(item: Pick<CalendarItem, "group" | "calendarId">, calendarOrder: string[]): Tone {
  if (item.group !== "works") return GROUP_TONE[item.group]
  const i = Math.max(0, calendarOrder.indexOf(item.calendarId ?? ""))
  return WORKS_TONES[i % WORKS_TONES.length]
}

export function groupTone(group: Exclude<CalendarGroup, "works">): Tone {
  return GROUP_TONE[group]
}

export function calendarTone(calendarId: string, calendarOrder: string[]): Tone {
  return toneOf({ group: "works", calendarId }, calendarOrder)
}
