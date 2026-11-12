// AI 활용 설문 — 응답(칸) → 수치 지표 → 회사 전체 추정. 순수(prisma 없음). 시험: lib/ai-survey/metrics.test.ts
//
// 토큰 근거는 외부 통계다(omnis-reports/infra-alternatives-261110/token-basis-261111.md, 2026-11-11 작업지시자 확정):
//   기업 중앙값 약 2,200만 · 구독 사무직 보통 6,000만 · 헤비 약 1.2억(1인 월 토큰), 옴니스 API 환산 100만 토큰당
//   캐시 66.6%(운영 실측) 1,250원 · 캐시 89%(벤치) 620원.
// 등급 경계(주당 시간) · 작업 크기 보정 · 횟수↔시간 환산은 이 파일이 둔 가정이다 — 바꾸면 화면의 「가정」 줄도 같이 바뀐다.
import { recordsByUser } from "./entry"
import { RECENT_TASKS, TASK_KINDS, WISH_TAGS, type Facts, type Slot, type TaskKind, type WishTag } from "./rules"

export type Intensity = "none" | "light" | "medium" | "heavy" | "unknown"
export const INTENSITY_LABEL: Record<Intensity, string> = { none: "없음", light: "가벼움", medium: "보통", heavy: "헤비", unknown: "알 수 없음" }

/** 등급별 1인 월 토큰 대표값 */
export const GRADE_TOKENS: Record<Exclude<Intensity, "unknown">, number> = { none: 0, light: 22_000_000, medium: 60_000_000, heavy: 120_000_000 }
/** 주당 사용 시간 경계 — 2시간 미만 가벼움 · 10시간 미만 보통 · 그 이상 헤비 */
export const GRADE_HOURS = { medium: 2, heavy: 10 } as const
/** 작업 크기 보정 */
export const SIZE_FACTOR: Record<string, number> = { short: 0.5, medium: 1, long: 1.5 }
/**
 * 가장 최근 일 하나에 주고받은 시간(구간 대표값, 분) → 작업 크기. 「보통 크기」(taskSize)보다 먼저 쓴다 —
 * 보통을 물으면 기억에 기대지만, 가장 최근 한 건은 덜 흔들린다(작업지시자 2026-11-12)
 */
export function sizeOfMinutes(min: number): "short" | "medium" | "long" {
  if (min <= 5) return "short"
  if (min <= 30) return "medium"
  return "long"
}
/** 한 번 묻는 데 드는 시간(분) — 횟수만 또는 시간만 답했을 때 다른 쪽을 어림한다 */
export const MINUTES_PER_SESSION = 10
/** 100만 토큰당 원 */
export const KRW_PER_MTOK = { cache66: 1250, cache89: 620 } as const
/** 가장 많이 하는 작업의 가중치 */
const MAIN_TASK_WEIGHT = 3

export const ASSUMPTIONS = [
  `강도 등급은 주당 사용 시간으로 나눈다 — ${GRADE_HOURS.medium}시간 미만 가벼움 · ${GRADE_HOURS.heavy}시간 미만 보통 · 그 이상 헤비`,
  `1인 월 토큰은 등급별 대표값(가벼움 2,200만 · 보통 6,000만 · 헤비 1.2억, 외부 통계)에 작업 크기 보정(짧음 ×0.5 · 문서 ×1 · 긴 작업 ×1.5)을 곱한다`,
  `작업 크기는 가장 최근 일 하나에 주고받은 시간으로 먼저 정한다 — 5분 이내 짧음 · 30분까지 문서 · 그보다 길면 긴 작업. 그 답이 없을 때만 「보통 크기」 답을 쓴다`,
  `사용 일수 · 시간은 지난주(월~일) 기준 답이다. 한 주라 그 주가 바빴거나 한가했으면 흔들린다`,
  `회사 전체 범위는 응답자를 전원의 표본으로 보고 낸 95% 범위다(유한 모집단 보정). 등급 대표값 자체의 오차는 넣지 않았다`,
  `앞뒤가 안 맞는 응답(확인 필요)은 회사 추정에서 빼고 따로 센다`,
  `횟수와 시간 중 하나만 답하면 한 번에 ${MINUTES_PER_SESSION}분으로 다른 쪽을 어림한다`,
  `작업 비중은 고른 작업을 같은 비중으로 두고 가장 많이 하는 작업만 ${MAIN_TASK_WEIGHT}배로 센다`,
  `하루 횟수 · 월 구독료는 구간으로 받아 구간의 대표값으로 센다. 「그 이상」 끝값(하루 10시간 이상 · 50번 넘게 · 40만원 넘게)은 그 하한으로 세고 「이상」 을 붙인다`,
  `API 환산은 100만 토큰당 ${KRW_PER_MTOK.cache66.toLocaleString("ko-KR")}원(캐시 66.6%) · ${KRW_PER_MTOK.cache89.toLocaleString("ko-KR")}원(캐시 89%)`,
] as const

export interface Metrics {
  intensity: Intensity
  daysPerWeek: number | null
  hoursPerWeek: number | null
  sessionsPerWeek: number | null
  /** 시간 · 횟수 중 어림한 쪽 */
  derived: "hours" | "sessions" | null
  /** 「그 이상」 끝값을 골라 하한으로 센 것 — 화면에 「이상」 을 붙인다 */
  atLeast: { amount?: true; fee?: true }
  /** 작업 종류별 비중(%) — 합 100 */
  taskShare: Partial<Record<TaskKind, number>>
  /** 「보통 크기」 답 */
  taskSize: string | null
  /** 가장 최근에 맡긴 일(값) · 주고받은 시간(분, 구간 대표값) · 몇 주 전 — 이 항목이 생기기 전 응답에는 없다 */
  recentTask?: string | null
  recentMinutes?: number | null
  recentWeeksAgo?: number | null
  /** 토큰 보정에 쓴 작업 크기와 그 출처 — 가장 최근 일의 시간이 먼저 */
  size?: string | null
  sizeFrom?: "recent" | "taskSize" | null
  /** 앞뒤가 안 맞는 답(코드가 판정) — 회사 추정에서 「확인 필요」 로 따로 센다 */
  flags?: Flag[]
  /** 등급을 알 수 없으면 null */
  monthlyTokens: number | null
  apiKrw: { cache66: number; cache89: number } | null
  tools: string[]
  payer: string | null
  monthlyFeeKrw: number | null
  limitHit: string | null
  wishTags: WishTag[]
  /** 「기타」 로 적은 바람 */
  wishNotes: string[]
  /** 범용 AI(ChatGPT · Claude · Gemini 같은 것)를 쓰며 아쉬운 점 — 옴니스에 대한 것이 아니다 */
  pains: string[]
  /** 지표 → 그 값이 나온 응답(turnId) */
  evidence: Record<string, string[]>
}

const known = (facts: Facts, slot: Slot) => (facts[slot] && !facts[slot]!.unknown ? facts[slot]! : undefined)
const round1 = (n: number) => Math.round(n * 10) / 10

// ─── 앞뒤가 안 맞는 답 ─────────────────────────────────────────────
// 모델이 아니라 코드가 판정한다(같은 응답이면 같은 결과). 틀렸다고 단정하지 않는다 — 응답자에게 한 번 묻고(강제 아님),
// 회사 추정에서는 「확인 필요」 로 따로 센다.

export type FlagCode = "free-heavy-no-limit" | "one-day-big-fee" | "short-only-heavy" | "zero-days-recent"
export interface Flag {
  code: FlagCode
  /** 고칠 만한 답 — 그 응답(turnId) */
  turnIds: string[]
}

/** 응답자에게 보이는 말(요약 확인 화면) */
export const FLAG_TEXT: Record<FlagCode, string> = {
  "free-heavy-no-limit": "유료 구독 없이 하루 8시간 넘게 쓰시는데, 한도에 걸린 적은 없다고 하셨어요.",
  "one-day-big-fee": "지난주에 하루만 쓰셨는데, 유료 구독료는 월 20만원이 넘어요.",
  "short-only-heavy": "짧은 질문에만 쓰신다고 하셨는데, 쓰는 시간은 헤비 수준이에요.",
  "zero-days-recent": "지난주에 쓴 날이 0일인데, 가장 최근 일은 지난주였다고 하셨어요.",
}
/** 관리자 화면의 짧은 이름 */
export const FLAG_LABEL: Record<FlagCode, string> = {
  "free-heavy-no-limit": "무료 · 하루 8시간 이상 · 한도 경험 없음",
  "one-day-big-fee": "주 1일 · 월 구독료 20만원 이상",
  "short-only-heavy": "짧은 질문뿐 · 헤비",
  "zero-days-recent": "지난주 0일 · 가장 최근 일이 지난주",
}
/** 판정 경계 — 하루 시간 · 구독료 */
export const FLAG_LIMITS = { hoursPerDay: 8, feeKrw: 200_000 } as const

export function consistencyFlags(facts: Facts, intensity: Intensity, hoursPerWeek: number | null): Flag[] {
  const out: Flag[] = []
  const ids = (...slots: Slot[]) => [...new Set(slots.map((s) => facts[s]?.turnId).filter((x): x is string => !!x))]
  const days = known(facts, "daysPerWeek")?.num ?? null
  const payer = known(facts, "payer")?.values?.[0]
  // 하루 시간 — 시간을 답했으면 그 값, 횟수만 답했으면 주당 어림을 쓴 날 수로 나눈다
  const perDay = known(facts, "hoursPerDay")?.num ?? (days && hoursPerWeek !== null ? hoursPerWeek / days : null)
  if (payer === "none" && perDay !== null && perDay >= FLAG_LIMITS.hoursPerDay && known(facts, "limitHit")?.values?.[0] === "never") {
    out.push({ code: "free-heavy-no-limit", turnIds: ids("payer", "hoursPerDay", "sessionsPerDay", "limitHit") })
  }
  const fee = known(facts, "monthlyFeeKrw")?.num ?? null
  if (days === 1 && payer && payer !== "none" && fee !== null && fee >= FLAG_LIMITS.feeKrw) {
    out.push({ code: "one-day-big-fee", turnIds: ids("daysPerWeek", "monthlyFeeKrw") })
  }
  const kinds = known(facts, "taskKinds")?.values ?? []
  if (kinds.length === 1 && kinds[0] === "short_qa" && intensity === "heavy") {
    out.push({ code: "short-only-heavy", turnIds: ids("taskKinds", "daysPerWeek", "hoursPerDay", "sessionsPerDay") })
  }
  if (days === 0 && known(facts, "recentWhen")?.num === 1) {
    out.push({ code: "zero-days-recent", turnIds: ids("daysPerWeek", "recentWhen") })
  }
  return out
}

export function intensityOf(daysPerWeek: number | null, hoursPerWeek: number | null): Intensity {
  if (daysPerWeek === 0) return "none"
  if (hoursPerWeek === null) return "unknown"
  // 쓰는 날이 있는데 시간이 0(30분 미만)이면 안 쓰는 것이 아니라 가볍게 쓰는 것이다
  if (hoursPerWeek < GRADE_HOURS.medium) return "light"
  return hoursPerWeek < GRADE_HOURS.heavy ? "medium" : "heavy"
}

/** 작업 비중(%) — 가장 큰 칸에 반올림 나머지를 몰아 합을 100 으로 맞춘다 */
export function taskShares(kinds: string[], main: string | undefined): Partial<Record<TaskKind, number>> {
  const valid = [...new Set(kinds)].filter((k): k is TaskKind => k in TASK_KINDS)
  if (valid.length === 0) return {}
  const top = main && valid.includes(main as TaskKind) ? (main as TaskKind) : valid.length === 1 ? valid[0] : undefined
  const weight = (k: TaskKind) => (k === top && valid.length > 1 ? MAIN_TASK_WEIGHT : 1)
  const total = valid.reduce((a, k) => a + weight(k), 0)
  const out: Partial<Record<TaskKind, number>> = {}
  for (const k of valid) out[k] = Math.round((weight(k) / total) * 100)
  const biggest = top ?? valid[0]
  out[biggest] = (out[biggest] ?? 0) + 100 - valid.reduce((a, k) => a + (out[k] ?? 0), 0)
  return out
}

export function computeMetrics(facts: Facts): Metrics {
  const ev: Record<string, string[]> = {}
  const src = (key: string, ...slots: Slot[]) => {
    const ids = [...new Set(slots.map((s) => facts[s]?.turnId).filter((x): x is string => !!x))]
    if (ids.length) ev[key] = ids
  }

  const days = known(facts, "daysPerWeek")?.num ?? null
  const hoursDay = known(facts, "hoursPerDay")?.num ?? null
  const sessionsDay = known(facts, "sessionsPerDay")?.num ?? null
  let hoursPerWeek: number | null = null
  let sessionsPerWeek: number | null = null
  let derived: Metrics["derived"] = null
  if (days === 0) {
    hoursPerWeek = 0
    sessionsPerWeek = 0
  } else if (days !== null) {
    if (hoursDay !== null) hoursPerWeek = round1(days * hoursDay)
    if (sessionsDay !== null) sessionsPerWeek = Math.round(days * sessionsDay)
    if (hoursPerWeek === null && sessionsPerWeek !== null) {
      hoursPerWeek = round1((sessionsPerWeek * MINUTES_PER_SESSION) / 60)
      derived = "hours"
    } else if (sessionsPerWeek === null && hoursPerWeek !== null) {
      sessionsPerWeek = Math.round((hoursPerWeek * 60) / MINUTES_PER_SESSION)
      derived = "sessions"
    }
  }
  const atLeast: Metrics["atLeast"] = {}
  if (days !== 0 && (known(facts, "hoursPerDay")?.over || known(facts, "sessionsPerDay")?.over)) atLeast.amount = true
  const intensity = intensityOf(days, hoursPerWeek)
  src("intensity", "daysPerWeek", "hoursPerDay", "sessionsPerDay")
  src("perWeek", "daysPerWeek", "hoursPerDay", "sessionsPerDay")

  const taskSize = known(facts, "taskSize")?.values?.[0] ?? null
  const taskShare = taskShares(known(facts, "taskKinds")?.values ?? [], known(facts, "mainTask")?.values?.[0])
  src("taskShare", "taskKinds", "mainTask")

  const recentTask = known(facts, "recentTask")?.values?.[0] ?? null
  const recentMinutes = known(facts, "recentTime")?.num ?? null
  const recentWeeksAgo = known(facts, "recentWhen")?.num ?? null
  src("recent", "recentTask", "recentWhen", "recentTime")
  // 작업 크기 — 가장 최근 일의 주고받은 시간이 먼저, 없으면 「보통 크기」
  const size = recentMinutes !== null ? sizeOfMinutes(recentMinutes) : taskSize
  const sizeFrom: Metrics["sizeFrom"] = recentMinutes !== null ? "recent" : taskSize ? "taskSize" : null
  const monthlyTokens = intensity === "unknown" ? null : Math.round(GRADE_TOKENS[intensity] * (size ? SIZE_FACTOR[size] ?? 1 : 1))
  src("monthlyTokens", "daysPerWeek", "hoursPerDay", "sessionsPerDay", ...(sizeFrom === "recent" ? (["recentTime"] as const) : (["taskSize"] as const)))
  const flags = consistencyFlags(facts, intensity, hoursPerWeek)

  const payer = known(facts, "payer")?.values?.[0] ?? null
  const fee = payer && payer !== "none" ? known(facts, "monthlyFeeKrw")?.num ?? null : payer === "none" ? 0 : null
  if (payer && payer !== "none" && known(facts, "monthlyFeeKrw")?.over) atLeast.fee = true
  src("subscription", "payer", "monthlyFeeKrw", "tools")
  src("limitHit", "limitHit")

  const wish = known(facts, "wishes")
  const wishTags = [...new Set(wish?.values ?? [])].filter((t): t is WishTag => t in WISH_TAGS)
  const wishNotes = wish?.others ?? []
  src("wishes", "wishes")
  src("pains", "pain")

  return {
    intensity, daysPerWeek: days, hoursPerWeek, sessionsPerWeek, derived, atLeast,
    taskShare, taskSize,
    recentTask, recentMinutes, recentWeeksAgo, size, sizeFrom, flags,
    monthlyTokens,
    apiKrw: monthlyTokens === null ? null : { cache66: Math.round((monthlyTokens / 1e6) * KRW_PER_MTOK.cache66), cache89: Math.round((monthlyTokens / 1e6) * KRW_PER_MTOK.cache89) },
    tools: known(facts, "tools")?.labels ?? [],
    payer, monthlyFeeKrw: fee,
    limitHit: known(facts, "limitHit")?.values?.[0] ?? null,
    wishTags, wishNotes,
    pains: known(facts, "pain")?.labels ?? [],
    evidence: ev,
  }
}

// ─── 회사 전체 ─────────────────────────────────────────────
// 관리자 화면 · API 가 받는 것은 합계뿐이다(작업지시자 2026-11-12). 이름 · 사람별 원문 · 사람별 지표는 여기서 나가지 않는다 —
// 개인 평가와 상관없다고 약속했으니, 누가 무엇을 답했는지 볼 길이 없어야 응답이 덜 흔들린다.
// 응답이 MIN_RESPONSES 명 미만이면 합계도 숨긴다(두 명이면 한 사람의 답을 빼서 알 수 있다).

export const MIN_RESPONSES = 3

/** 사람마다 묶을 응답 한 행 — facts 에서 지표를 다시 낸다(저장된 지표가 이 판정이 생기기 전 것이어도 같은 규칙으로 센다) */
export interface SurveyRow {
  userId: string
  status: string
  createdAt: Date
  facts: unknown
}

export interface Ranked {
  label: string
  count: number
}

export interface CompanyTotals {
  /** 쓴 날 수를 답한 사람의 평균(지난주) */
  avgDays: number | null
  grades: Record<Intensity, number>
  /** 유료로 쓰는 사람 · 그중 개인이 (일부라도) 내는 사람 */
  paid: number
  personalPay: number
  subscriptionKrw: number
  /** 앞뒤가 안 맞아 추정에서 뺀 응답 · 판정별 수 */
  needsCheck: number
  flagCounts: { code: FlagCode; count: number }[]
  /** 토큰 추정에 쓴 응답 수(확인 필요 · 사용량 모름 제외) */
  counted: number
  unknownGrade: number
  /** 응답자 합 · 전원 환산(± 95% 범위). counted 가 0 이면 null */
  tokens: { respondents: number; projected: number; low: number; high: number } | null
  apiKrw: { low: number; high: number } | null
  taskShare: { kind: TaskKind; pct: number }[]
  wishRanking: { tag: WishTag; count: number }[]
  /** 범용 AI 의 아쉬운 점 — 두 명 이상이 같은 말을 고른 것만 이름을 보이고 나머지는 othersCount 로 센다 */
  painRanking: Ranked[]
  painOthers: number
  /** 「기타」 로 적은 바람 — 두 명 이상 같은 글만 보인다 */
  wishNotes: Ranked[]
  wishOthers: number
  recentTasks: Ranked[]
}

export interface CompanySummary {
  headcount: number
  respondents: number
  inProgress: number
  notStarted: number
  /** 응답이 MIN_RESPONSES 명 미만이면 null — 합계도 보이지 않는다 */
  totals: CompanyTotals | null
}

const krw = (tokens: number) => ({ cache66: Math.round((tokens / 1e6) * KRW_PER_MTOK.cache66), cache89: Math.round((tokens / 1e6) * KRW_PER_MTOK.cache89) })

/** 같은 말끼리 센다 — 두 명 이상이 같은 말이면 이름을 보이고, 한 명만 쓴 말은 수만 센다(글로 사람을 짚지 못하게) */
function rankShared(lists: string[][]): { shown: Ranked[]; others: number } {
  const count = new Map<string, number>()
  for (const l of lists) for (const x of new Set(l.map((s) => s.trim()).filter(Boolean))) count.set(x, (count.get(x) ?? 0) + 1)
  const all = [...count.entries()].map(([label, n]) => ({ label, count: n }))
  return { shown: all.filter((r) => r.count >= 2).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)), others: all.filter((r) => r.count < 2).length }
}

/** 응답자 표본 → 전원 합계와 95% 범위(유한 모집단 보정) */
export function projectTotal(values: number[], headcount: number): { respondents: number; projected: number; low: number; high: number } | null {
  const n = values.length
  if (n === 0) return null
  const sum = values.reduce((a, b) => a + b, 0)
  const mean = sum / n
  const N = Math.max(headcount, n)
  const projected = Math.round(mean * N)
  if (n < 2 || n >= N) return { respondents: Math.round(sum), projected, low: projected, high: projected }
  const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1))
  const half = 1.96 * N * (sd / Math.sqrt(n)) * Math.sqrt((N - n) / (N - 1))
  return { respondents: Math.round(sum), projected, low: Math.max(0, Math.round(projected - half)), high: Math.round(projected + half) }
}

/**
 * 재직 구성원 기준 합계. 구성원이 아닌 사람의 설문(퇴사 등)은 세지 않는다.
 * 사람마다 가장 최근에 제출한 1건만 센다(entry.ts recordsByUser).
 */
export function companySummary(memberIds: string[], rows: SurveyRow[]): CompanySummary {
  const members = new Set(memberIds)
  const byUser = recordsByUser(rows.filter((r) => members.has(r.userId)))
  const done: Metrics[] = []
  let inProgress = 0
  for (const id of members) {
    const u = byUser.get(id)
    if (!u) continue
    if (u.counted) done.push(computeMetrics((u.counted.facts as Facts | null) ?? {}))
    else inProgress += 1
  }
  const headcount = members.size
  const base = { headcount, respondents: done.length, inProgress, notStarted: headcount - done.length - inProgress }
  if (done.length < MIN_RESPONSES) return { ...base, totals: null }

  const flagged = done.filter((m) => (m.flags ?? []).length > 0)
  const clean = done.filter((m) => (m.flags ?? []).length === 0)
  const counted = clean.filter((m) => m.monthlyTokens !== null)
  const tokens = projectTotal(counted.map((m) => m.monthlyTokens!), headcount)
  const grades: Record<Intensity, number> = { none: 0, light: 0, medium: 0, heavy: 0, unknown: 0 }
  for (const m of done) grades[m.intensity] += 1
  const days = done.map((m) => m.daysPerWeek).filter((d): d is number => d !== null)
  const flagCount = new Map<FlagCode, number>()
  for (const m of flagged) for (const f of m.flags ?? []) flagCount.set(f.code, (flagCount.get(f.code) ?? 0) + 1)
  const wish = new Map<WishTag, number>()
  const share = new Map<TaskKind, number>()
  let withTasks = 0
  for (const m of done) {
    for (const t of new Set(m.wishTags)) wish.set(t, (wish.get(t) ?? 0) + 1)
    const entries = Object.entries(m.taskShare) as [TaskKind, number][]
    if (entries.length) {
      withTasks += 1
      for (const [k, pct] of entries) share.set(k, (share.get(k) ?? 0) + pct)
    }
  }
  const pains = rankShared(done.map((m) => m.pains))
  const notes = rankShared(done.map((m) => m.wishNotes))
  const recent = new Map<string, number>()
  for (const m of done) if (m.recentTask) recent.set(m.recentTask, (recent.get(m.recentTask) ?? 0) + 1)
  return {
    ...base,
    totals: {
      avgDays: days.length ? round1(days.reduce((a, b) => a + b, 0) / days.length) : null,
      grades,
      paid: done.filter((m) => m.payer && m.payer !== "none").length,
      personalPay: done.filter((m) => m.payer === "personal" || m.payer === "both").length,
      subscriptionKrw: done.reduce((a, m) => a + (m.payer && m.payer !== "none" ? m.monthlyFeeKrw ?? 0 : 0), 0),
      needsCheck: flagged.length,
      flagCounts: [...flagCount.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count),
      counted: counted.length,
      unknownGrade: clean.length - counted.length,
      tokens,
      apiKrw: tokens ? { low: krw(tokens.low).cache89, high: krw(tokens.high).cache66 } : null,
      taskShare: [...share.entries()].map(([kind, sum]) => ({ kind, pct: Math.round(sum / withTasks) })).sort((a, b) => b.pct - a.pct),
      wishRanking: [...wish.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || Number(a.tag === "other") - Number(b.tag === "other") || a.tag.localeCompare(b.tag)),
      painRanking: pains.shown,
      painOthers: pains.others,
      wishNotes: notes.shown,
      wishOthers: notes.others,
      recentTasks: [...recent.entries()].map(([v, count]) => ({ label: RECENT_TASKS[v as keyof typeof RECENT_TASKS] ?? v, count })).sort((a, b) => b.count - a.count),
    },
  }
}

/** 응답자가 확인할 한 문단 — 모델이 요약을 못 만들 때도 이것으로 마무리한다 */
export function summaryText(m: Metrics): string {
  const lines: string[] = []
  if (m.intensity === "none") lines.push("회사 일에는 AI 를 쓰지 않습니다.")
  else if (m.daysPerWeek !== null) {
    const amount = m.hoursPerWeek !== null ? ` · 주당 약 ${m.hoursPerWeek}시간${m.atLeast?.amount ? " 이상" : ""}` : ""
    lines.push(`회사 일에 AI 를 주 ${m.daysPerWeek}일${amount} 씁니다(${INTENSITY_LABEL[m.intensity]}).`)
  }
  if (m.tools.length) lines.push(`쓰는 도구: ${m.tools.join(", ")}.`)
  if (m.payer === "none") lines.push("유료 구독은 없습니다.")
  else if (m.payer) lines.push(`유료 구독: ${{ company: "회사 부담", personal: "개인 부담", both: "회사 · 개인 둘 다" }[m.payer] ?? m.payer}${m.monthlyFeeKrw ? ` · 월 ${m.monthlyFeeKrw.toLocaleString("ko-KR")}원${m.atLeast?.fee ? " 이상" : "쯤"}` : ""}.`)
  const tasks = (Object.entries(m.taskShare) as [TaskKind, number][]).sort((a, b) => b[1] - a[1]).map(([k, p]) => `${TASK_KINDS[k]} ${p}%`)
  if (tasks.length) lines.push(`주로 하는 작업: ${tasks.join(" · ")}.`)
  const wishes = [...m.wishTags.filter((t) => t !== "other").map((t) => WISH_TAGS[t]), ...m.wishNotes]
  if (wishes.length) lines.push(`옴니스에 바라는 것: ${wishes.join(", ")}.`)
  if (m.pains.length) lines.push(`범용 AI 에서 아쉬운 점: ${m.pains.join(", ")}.`)
  return lines.join(" ") || "답한 내용이 거의 없습니다."
}

/** 「6,000만」 「1.2억」 — 토큰 수를 읽기 쉽게 */
export function tokensLabel(n: number): string {
  if (n >= 1e8) return `${Math.round(n / 1e7) / 10}억`
  if (n >= 1e4) return `${Math.round(n / 1e4).toLocaleString("ko-KR")}만`
  return n.toLocaleString("ko-KR")
}

// ─── 응답 대기 측정 ─────────────────────────────────────────────

interface Timed {
  source: "model" | "fallback"
  ms: { first: number | null; total: number }
  clientMs?: { first: number; ready: number }
}

export interface LatencyRow {
  /** 무엇을 잰 것인가 */
  label: string
  count: number
  /** 중앙값 · 90%값(ms). 표본이 없으면 null */
  p50: number | null
  p90: number | null
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

function row(label: string, xs: (number | null | undefined)[]): LatencyRow {
  const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b)
  return { label, count: v.length, p50: v.length ? Math.round(quantile(v, 0.5)) : null, p90: v.length ? Math.round(quantile(v, 0.9)) : null }
}

/**
 * 설문 여러 건의 턴 → 대기 시간 표. 모델이 만든 질문만 센다(준비된 질문은 기다림이 없다).
 * 첫 질문과 그 뒤 턴을 가른다 — 첫 질문은 「시작」 을 누르고 기다리는 시간이라 체감이 다르다.
 */
export function latencyTable(surveys: Timed[][]): LatencyRow[] {
  const firsts = surveys.map((t) => t[0]).filter((t): t is Timed => !!t && t.source === "model")
  const rest = surveys.flatMap((t) => t.slice(1)).filter((t) => t.source === "model")
  return [
    row("첫 질문 — 글자가 보이기까지(화면)", firsts.map((t) => t.clientMs?.first)),
    row("첫 질문 — 폼이 뜨기까지(화면)", firsts.map((t) => t.clientMs?.ready)),
    row("첫 질문 — 첫 글자(서버)", firsts.map((t) => t.ms.first)),
    row("첫 질문 — 전체(서버)", firsts.map((t) => t.ms.total)),
    row("다음 질문 — 글자가 보이기까지(화면)", rest.map((t) => t.clientMs?.first)),
    row("다음 질문 — 폼이 뜨기까지(화면)", rest.map((t) => t.clientMs?.ready)),
    row("다음 질문 — 첫 글자(서버)", rest.map((t) => t.ms.first)),
    row("다음 질문 — 전체(서버)", rest.map((t) => t.ms.total)),
  ]
}
