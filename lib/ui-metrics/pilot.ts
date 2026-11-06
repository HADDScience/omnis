import { kstDayStart, median } from "./rules"

/**
 * 카톡 → 옴니스 시범 운영을 판단할 측정 — 주 단위로 묶는 순수 함수만 둔다. 시험: pilot.test.ts
 * 설계: mydocs/plans/2026-11-06-pilot-metrics.md
 *
 * 들어오는 것은 숫자 · 식별자 · 시각뿐이다. 글 내용 · 방 이름은 이 함수에 넘기지 않는다(방 이름은 화면이 따로 붙인다).
 */

/** 서버가 직접 남기는 기록. 화면이 보내는 묶음(uiEventBatchSchema)에는 들어갈 수 없다 — 숫자를 부풀리지 못하게 */
export const SERVER_EVENT_NAMES = [
  "push_sent", // value: 그 사람의 기기 중 푸시 서비스가 받아 간 수
  "search_chat", // 방 안 글 검색(첫 쪽만)
  "search_photo", // 그중 사진 설명까지 찾은 검색(전사방). value: 걸린 사진 수
  "search_global", // 위쪽 통합 검색(⌘K) — 2026-11-06 걷었다. 그 전 기록을 읽으려고 이름은 남긴다
] as const

export type ServerEventName = (typeof SERVER_EVENT_NAMES)[number]

/** 입력하면서 자동으로 다시 찾는 요청은 한 번으로 센다 — 같은 사람이 이 안에 이어 보낸 것 */
export const SEARCH_SESSION_GAP_MS = 60_000
/** 화면에 펴는 주 수 */
export const PILOT_WEEKS = 8

const KST_MS = 9 * 3_600_000
const DAY_MS = 86_400_000

/** 한국 시간 월요일 0시 */
export function kstWeekStart(at: Date): Date {
  const day = kstDayStart(at)
  const weekday = (new Date(day.getTime() + KST_MS).getUTCDay() + 6) % 7 // 월 0 … 일 6
  return new Date(day.getTime() - weekday * DAY_MS)
}

/** 이번 주를 포함해 지난 n 주의 시작 시각. 옛 주가 먼저 */
export function pilotWeeks(now: Date, n = PILOT_WEEKS): Date[] {
  const current = kstWeekStart(now).getTime()
  return Array.from({ length: n }, (_, i) => new Date(current - (n - 1 - i) * 7 * DAY_MS))
}

export interface PilotInput {
  weeks: Date[]
  /** UiEvent — 화면 · service worker · 서버가 남긴 것 */
  events: { userId: string; name: string; value: number | null; at: Date }[]
  /** 방 · 하루(KST 0시) · 직접 쓴 글 수 · 카톡 이식 글 수 */
  roomDays: { roomId: string; day: Date; direct: number; kakao: number }[]
  /** 옴니스에서 직접 글을 쓴 사람 · 하루 */
  writerDays: { userId: string; day: Date }[]
  /** 옴니스 질문. photo: 답의 출처에 사진이 있었다 */
  queries: { userId: string; at: Date; photo: boolean }[]
}

export interface PilotWeek {
  week: string
  push: {
    /** 푸시 서비스가 받아 간 기기 수 */
    sent: number
    /** 기기(service worker)가 받았다고 알려 온 수 */
    received: number
    /** 알림을 눌러 연 수 */
    opened: number
    /** received / sent. 보낸 것이 없으면 null */
    receivedRate: number | null
    medianReceiveS: number | null
    p90ReceiveS: number | null
    medianOpenS: number | null
  }
  messages: { direct: number; kakao: number; /** kakao / (direct + kakao) */ kakaoShare: number | null }
  omnisAsks: number
  photoAnswers: number
  searches: number
  photoSearches: number
  /** 그 주에 한 번이라도 쓴 사람 수 · 사람-날 합 */
  activePeople: number
  activePersonDays: number
}

export interface PilotRoomRow {
  roomId: string
  weeks: { direct: number; kakao: number }[]
  direct: number
  kakao: number
}

export interface PilotPersonRow {
  userId: string
  /** 주마다 쓴 날 수(0~7) */
  weeks: number[]
}

export interface PilotSummary {
  weeks: PilotWeek[]
  rooms: PilotRoomRow[]
  people: PilotPersonRow[]
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]
}

/** 같은 사람 · 같은 이름이 gap 안에 이어 온 기록은 하나로 센다. 시각 순서와 상관없다 */
export function sessionize<T extends { userId: string; name: string; at: Date }>(rows: T[], gapMs = SEARCH_SESSION_GAP_MS): T[] {
  const last = new Map<string, number>()
  const kept: T[] = []
  for (const r of [...rows].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    const key = `${r.userId}\u0000${r.name}`
    const prev = last.get(key)
    last.set(key, r.at.getTime())
    if (prev !== undefined && r.at.getTime() - prev < gapMs) continue
    kept.push(r)
  }
  return kept
}

/** 나머지 칸은 화면이 붙인다. 주 범위 밖의 기록은 버린다 */
export function summarizePilot(input: PilotInput): PilotSummary {
  const starts = input.weeks.map((w) => w.getTime())
  const end = starts.length ? starts[starts.length - 1] + 7 * DAY_MS : 0
  const weekIndex = (at: Date): number => {
    const t = at.getTime()
    if (!starts.length || t < starts[0] || t >= end) return -1
    return Math.floor((t - starts[0]) / (7 * DAY_MS))
  }

  const weeks = input.weeks.map(() => ({
    sent: 0, received: [] as number[], opened: [] as number[],
    direct: 0, kakao: 0, asks: 0, photoAnswers: 0, searches: 0, photoSearches: 0,
    activeDays: new Map<string, Set<number>>(),
  }))
  const active = (userId: string, at: Date) => {
    const i = weekIndex(at)
    if (i < 0) return
    let days = weeks[i].activeDays.get(userId)
    if (!days) weeks[i].activeDays.set(userId, (days = new Set()))
    days.add(kstDayStart(at).getTime())
  }

  const searches = sessionize(input.events.filter((e) => e.name === "search_chat" || e.name === "search_global"))
  const photoSearches = sessionize(input.events.filter((e) => e.name === "search_photo"))
  for (const e of searches) {
    const i = weekIndex(e.at)
    if (i >= 0) weeks[i].searches++
  }
  for (const e of photoSearches) {
    const i = weekIndex(e.at)
    if (i >= 0) weeks[i].photoSearches++
  }

  for (const e of input.events) {
    const i = weekIndex(e.at)
    if (i < 0) continue
    const w = weeks[i]
    if (e.name === "push_sent") {
      w.sent += e.value ?? 0
      continue // 받은 쪽이 쓴 것이 아니다 — 활성으로 세지 않는다
    }
    if (e.name === "push_recv_s") {
      if (e.value !== null) w.received.push(e.value)
      continue // 기기가 알아서 받은 것이다
    }
    if (e.name === "push_open_s" && e.value !== null) w.opened.push(e.value)
    active(e.userId, e.at)
  }

  const rooms = new Map<string, PilotRoomRow>()
  for (const r of input.roomDays) {
    const i = weekIndex(r.day)
    if (i < 0) continue
    weeks[i].direct += r.direct
    weeks[i].kakao += r.kakao
    let row = rooms.get(r.roomId)
    if (!row) rooms.set(r.roomId, (row = { roomId: r.roomId, weeks: input.weeks.map(() => ({ direct: 0, kakao: 0 })), direct: 0, kakao: 0 }))
    row.weeks[i].direct += r.direct
    row.weeks[i].kakao += r.kakao
    row.direct += r.direct
    row.kakao += r.kakao
  }
  for (const w of input.writerDays) active(w.userId, w.day)
  for (const q of input.queries) {
    const i = weekIndex(q.at)
    if (i < 0) continue
    weeks[i].asks++
    if (q.photo) weeks[i].photoAnswers++
    active(q.userId, q.at)
  }

  const people = new Map<string, number[]>()
  weeks.forEach((w, i) => {
    for (const [userId, days] of w.activeDays) {
      let row = people.get(userId)
      if (!row) people.set(userId, (row = input.weeks.map(() => 0)))
      row[i] = days.size
    }
  })

  return {
    weeks: weeks.map((w, i): PilotWeek => {
      const total = w.direct + w.kakao
      return {
        week: input.weeks[i].toISOString(),
        push: {
          sent: w.sent,
          received: w.received.length,
          opened: w.opened.length,
          receivedRate: w.sent ? w.received.length / w.sent : null,
          medianReceiveS: median(w.received),
          p90ReceiveS: percentile(w.received, 90),
          medianOpenS: median(w.opened),
        },
        messages: { direct: w.direct, kakao: w.kakao, kakaoShare: total ? w.kakao / total : null },
        omnisAsks: w.asks,
        photoAnswers: w.photoAnswers,
        searches: w.searches,
        photoSearches: w.photoSearches,
        activePeople: w.activeDays.size,
        activePersonDays: [...w.activeDays.values()].reduce((n, d) => n + d.size, 0),
      }
    }),
    rooms: [...rooms.values()].sort((a, b) => b.direct + b.kakao - (a.direct + a.kakao)),
    people: [...people.entries()].map(([userId, w]) => ({ userId, weeks: w })),
  }
}
