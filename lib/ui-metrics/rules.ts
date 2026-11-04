import { z } from "zod"

import { SHORTCUTS } from "@/lib/shortcuts"

/**
 * UI 변경 적응 부담 측정의 규칙 — 무엇을 받고 언제 묻는지. 순수 함수만 둔다. 시험: rules.test.ts
 * 설계: mydocs/plans/2026-11-04-ui-metrics.md
 *
 * **내용을 받지 않는 것은 이 파일의 스키마가 지킨다.** 이름은 목록에 있는 것만, 값은 정수만,
 * 경로는 서버가 아는 칸만 남기고 나머지를 `:id` 로 바꾼다. 모르는 칸이 온 요청은 통째로 거절한다.
 */

export const UI_EVENT_NAMES = [
  "room_open_to_send", // value: 방을 연 뒤 첫 전송까지 ms
  "attach_failed", // value: HTTP 상태(있을 때)
  "attach_retry",
  "menu_open",
  "menu_dismiss",
  "menu_act",
  "plus_open",
  "plus_dismiss",
  "plus_act",
  ...SHORTCUTS.map((s) => `shortcut.${s.id}` as const),
] as const

export type UiEventName = (typeof UI_EVENT_NAMES)[number]

/** 한 묶음의 상한. 화면은 이만큼 차면 보낸다 */
export const UI_BATCH_SIZE = 20
export const UI_EVENT_RETENTION_DAYS = 90
/** 방을 연 채 자리를 비운 시간은 적응 부담이 아니다 — 이보다 길면 기록하지 않는다 */
export const ROOM_OPEN_MAX_MS = 30 * 60_000
/** 실패 뒤 이 안에 다시 올리면 재시도로 센다 */
export const ATTACH_RETRY_WINDOW_MS = 10 * 60_000
/** 배포 뒤 이만큼 지나면 묻지 않는다. 오래 비운 사람에게 옛 배포를 묻지 않게 */
export const SURVEY_WINDOW_DAYS = 7
export const SURVEY_COMMENT_MAX = 140
/**
 * 설문을 띄우는가. 어떻게 물을지 더 정하기로 해 꺼 두었다(2026-11-04 작업지시자). 사용 기록 수집과 표 · API 는 그대로다.
 * 화면과 서버가 함께 본다 — 열어 둔 탭의 옛 빌드는 화면 쪽 값을 모르므로 서버가 물을 배포를 돌려주지 않아야 뜨지 않는다.
 */
export const UI_SURVEY_ENABLED = false as boolean
/** 배포 커밋이 없는 빌드(로컬). 설문 대상이 아니다 */
export const DEV_SHA = "dev"

const shaSchema = z.string().regex(/^([0-9a-f]{7,40}|dev)$/)

export const uiEventBatchSchema = z
  .object({
    sha: shaSchema,
    events: z
      .array(
        z
          .object({
            name: z.enum(UI_EVENT_NAMES),
            value: z.number().int().min(0).max(ROOM_OPEN_MAX_MS).optional(),
            path: z.string().max(512),
          })
          .strict(),
      )
      .min(1)
      .max(UI_BATCH_SIZE * 2),
  })
  .strict()

export const uiSurveyAnswerSchema = z
  .object({
    sha: shaSchema,
    /** null 이면 답하지 않고 닫았다 — 다시 묻지 않으려고 남긴다 */
    score: z.number().int().min(1).max(5).nullable(),
    // 한 줄이다. 줄바꿈으로 긴 글을 옮겨 붙이지 못하게 한다
    comment: z.string().trim().max(SURVEY_COMMENT_MAX).regex(/^[^\r\n]*$/).optional(),
  })
  .strict()

/** 값이 아니라 화면 이름인 칸. app/(main) 의 경로 칸이다. 여기 없는 칸은 전부 :id — 새 화면이 빠져도 새지 않는다 */
const STATIC_PATH_SEGMENTS = new Set([
  "ask", "c", "calendar", "chat", "company", "context", "crm", "dashboard", "inquiries", "intake",
  "inventory", "invoices", "ip", "market", "members", "nas", "new", "nodes", "omnis", "orgs",
  "overview", "payments", "people", "projects", "proposals", "quotes", "record", "records",
  "register", "reports", "samples", "settings", "staff", "task", "tasks", "todo", "ui-metrics", "workspace",
])

/** `/chat/abc?x=1` → `/chat/:id`. 질의문자 · 해시를 떼고 ID · 슬러그 · 이름을 지운다 */
export function pathPattern(path: string): string {
  const clean = path.split(/[?#]/, 1)[0]
  const parts = clean.split("/").filter(Boolean).slice(0, 6)
  return "/" + parts.map((p) => (STATIC_PATH_SEGMENTS.has(p) ? p : ":id")).join("/")
}

/** 첫 전송까지 잴 자리 — 방 화면만. 새 방 만들기(/chat/new)는 아니다 */
export function isRoomPattern(pattern: string): boolean {
  return pattern === "/chat/:id" || pattern === "/chat/task/:id"
}

export function retentionCutoff(now: Date): Date {
  return new Date(now.getTime() - UI_EVENT_RETENTION_DAYS * 86_400_000)
}

const KST_MS = 9 * 3_600_000

/** 한국 날짜가 시작하는 시각 */
export function kstDayStart(now: Date): Date {
  const t = now.getTime() + KST_MS
  return new Date(t - (t % 86_400_000) - KST_MS)
}

export function kstDayKey(now: Date): string {
  return kstDayStart(new Date(now.getTime())).getTime().toString(36)
}

/**
 * 지금 이 사람에게 물을 배포. 없으면 null.
 *
 * - 처음 쓰인 날의 다음 날(한국 시간)부터, 이 사람이 실제로 써 본 배포만 묻는다.
 * - 그중 가장 새 배포 하나만 본다. 그것을 답했거나 닫았으면 옛 배포를 이어서 묻지 않는다 — 하루에 한 번을 넘지 않는다.
 */
export function pickSurveyTarget(input: {
  deployments: { sha: string; firstSeenAt: Date }[]
  usedShas: ReadonlySet<string>
  answeredShas: ReadonlySet<string>
  now: Date
}): string | null {
  const today = kstDayStart(input.now).getTime()
  const eligible = input.deployments
    .filter((d) => d.sha !== DEV_SHA && input.usedShas.has(d.sha) && d.firstSeenAt.getTime() < today)
    .sort((a, b) => b.firstSeenAt.getTime() - a.firstSeenAt.getTime())
  const newest = eligible[0]
  if (!newest || input.answeredShas.has(newest.sha)) return null
  if (input.now.getTime() - newest.firstSeenAt.getTime() > SURVEY_WINDOW_DAYS * 86_400_000) return null
  return newest.sha
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

export interface UiMetricCounts {
  attachFailed: number
  attachRetry: number
  menuOpen: number
  menuDismiss: number
  plusOpen: number
  plusDismiss: number
  plusAct: number
  shortcut: number
}

export interface UiMetricRow {
  medianMs: number | null
  sends: number
  counts: UiMetricCounts
}

export interface UiPersonRow extends UiMetricRow {
  userId: string
  name: string
  score: number | null
  dismissed: boolean
  comment: string | null
}

export interface UiDeploymentRow extends UiMetricRow {
  sha: string
  firstSeenAt: string
  medianScore: number | null
  answers: number
  dismissals: number
  people: UiPersonRow[]
}

const emptyCounts = (): UiMetricCounts => ({
  attachFailed: 0, attachRetry: 0, menuOpen: 0, menuDismiss: 0, plusOpen: 0, plusDismiss: 0, plusAct: 0, shortcut: 0,
})

const COUNT_KEY: Partial<Record<string, keyof UiMetricCounts>> = {
  attach_failed: "attachFailed",
  attach_retry: "attachRetry",
  menu_open: "menuOpen",
  menu_dismiss: "menuDismiss",
  plus_open: "plusOpen",
  plus_dismiss: "plusDismiss",
  plus_act: "plusAct",
}

/** 배포별 · 사람별 중앙값과 점수. 새 배포가 먼저 */
export function summarize(input: {
  events: { commitSha: string; userId: string; name: string; value: number | null; at: Date }[]
  responses: { commitSha: string; userId: string; score: number | null; comment: string | null; createdAt: Date }[]
  names: ReadonlyMap<string, string>
}): UiDeploymentRow[] {
  type Person = { sends: number[]; counts: UiMetricCounts; score: number | null; dismissed: boolean; comment: string | null }
  type Deployment = { first: number; people: Map<string, Person> }
  const deployments = new Map<string, Deployment>()
  const touch = (sha: string, userId: string, at: Date): Person => {
    let d = deployments.get(sha)
    if (!d) deployments.set(sha, (d = { first: at.getTime(), people: new Map() }))
    d.first = Math.min(d.first, at.getTime())
    let p = d.people.get(userId)
    if (!p) d.people.set(userId, (p = { sends: [], counts: emptyCounts(), score: null, dismissed: false, comment: null }))
    return p
  }

  for (const e of input.events) {
    const p = touch(e.commitSha, e.userId, e.at)
    if (e.name === "room_open_to_send") {
      if (e.value !== null) p.sends.push(e.value)
    } else if (e.name.startsWith("shortcut.")) {
      p.counts.shortcut++
    } else {
      const key = COUNT_KEY[e.name]
      if (key) p.counts[key]++
    }
  }
  for (const r of input.responses) {
    const p = touch(r.commitSha, r.userId, r.createdAt)
    p.score = r.score
    p.dismissed = r.score === null
    p.comment = r.comment
  }

  return [...deployments.entries()]
    .sort((a, b) => b[1].first - a[1].first)
    .map(([sha, d]) => {
      const people = [...d.people.entries()].map(([userId, p]): UiPersonRow => ({
        userId,
        name: input.names.get(userId) ?? "(지운 계정)",
        medianMs: median(p.sends),
        sends: p.sends.length,
        counts: p.counts,
        score: p.score,
        dismissed: p.dismissed,
        comment: p.comment,
      }))
      const all = [...d.people.values()]
      const counts = emptyCounts()
      for (const p of all) for (const k of Object.keys(counts) as (keyof UiMetricCounts)[]) counts[k] += p.counts[k]
      const scores = all.flatMap((p) => (p.score === null ? [] : [p.score]))
      return {
        sha,
        firstSeenAt: new Date(d.first).toISOString(),
        medianMs: median(all.flatMap((p) => p.sends)),
        sends: all.reduce((n, p) => n + p.sends.length, 0),
        counts,
        medianScore: median(scores),
        answers: scores.length,
        dismissals: all.filter((p) => p.dismissed).length,
        people: people.sort((a, b) => a.name.localeCompare(b.name, "ko")),
      }
    })
}
