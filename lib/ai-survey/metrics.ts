// AI 활용 설문 — 응답(칸) → 수치 지표 → 회사 전체 추정. 순수(prisma 없음). 시험: lib/ai-survey/metrics.test.ts
//
// 토큰 근거는 외부 통계다(omnis-reports/infra-alternatives-261110/token-basis-261111.md, 2026-11-11 작업지시자 확정):
//   기업 중앙값 약 2,200만 · 구독 사무직 보통 6,000만 · 헤비 약 1.2억(1인 월 토큰), 옴니스 API 환산 100만 토큰당
//   캐시 66.6%(운영 실측) 1,250원 · 캐시 89%(벤치) 620원.
// 등급 경계(주당 시간) · 작업 크기 보정 · 횟수↔시간 환산은 이 파일이 둔 가정이다 — 바꾸면 화면의 「가정」 줄도 같이 바뀐다.
import { TASK_KINDS, WISH_TAGS, type Facts, type Slot, type TaskKind, type WishTag } from "./rules"

export type Intensity = "none" | "light" | "medium" | "heavy" | "unknown"
export const INTENSITY_LABEL: Record<Intensity, string> = { none: "없음", light: "가벼움", medium: "보통", heavy: "헤비", unknown: "알 수 없음" }

/** 등급별 1인 월 토큰 대표값 */
export const GRADE_TOKENS: Record<Exclude<Intensity, "unknown">, number> = { none: 0, light: 22_000_000, medium: 60_000_000, heavy: 120_000_000 }
/** 주당 사용 시간 경계 — 2시간 미만 가벼움 · 10시간 미만 보통 · 그 이상 헤비 */
export const GRADE_HOURS = { medium: 2, heavy: 10 } as const
/** 작업 크기 보정 */
export const SIZE_FACTOR: Record<string, number> = { short: 0.5, medium: 1, long: 1.5 }
/** 한 번 묻는 데 드는 시간(분) — 횟수만 또는 시간만 답했을 때 다른 쪽을 어림한다 */
export const MINUTES_PER_SESSION = 10
/** 100만 토큰당 원 */
export const KRW_PER_MTOK = { cache66: 1250, cache89: 620 } as const
/** 가장 많이 하는 작업의 가중치 */
const MAIN_TASK_WEIGHT = 3

export const ASSUMPTIONS = [
  `강도 등급은 주당 사용 시간으로 나눈다 — ${GRADE_HOURS.medium}시간 미만 가벼움 · ${GRADE_HOURS.heavy}시간 미만 보통 · 그 이상 헤비`,
  `1인 월 토큰은 등급별 대표값(가벼움 2,200만 · 보통 6,000만 · 헤비 1.2억, 외부 통계)에 작업 크기 보정(짧음 ×0.5 · 문서 ×1 · 긴 작업 ×1.5)을 곱한다`,
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
  taskSize: string | null
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

  const monthlyTokens = intensity === "unknown" ? null : Math.round(GRADE_TOKENS[intensity] * (taskSize ? SIZE_FACTOR[taskSize] ?? 1 : 1))
  src("monthlyTokens", "daysPerWeek", "hoursPerDay", "sessionsPerDay", "taskSize")

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

export interface CompanyInput {
  members: { id: string; name: string }[]
  /** 제출한 설문만 지표가 있다 */
  surveys: { userId: string; status: string; metrics: Metrics | null }[]
}

export interface CompanyEstimate {
  headcount: number
  respondents: number
  /** 시작했지만 제출하지 않은 사람 */
  inProgress: string[]
  /** 시작도 하지 않은 사람 */
  notStarted: string[]
  /** 응답자 합산 */
  monthlyTokens: number
  apiKrw: { cache66: number; cache89: number }
  /** 등급을 알 수 없어 합산에서 빠진 응답자 수 */
  unknownGrade: number
  /** 응답자 평균을 전원에게 늘린 값 — 응답자가 없으면 null */
  projected: { monthlyTokens: number; apiKrw: { cache66: number; cache89: number } } | null
  subscriptionKrw: { company: number; personal: number; both: number; total: number }
  grades: Record<Intensity, number>
  /** 작업 종류 분포(%) — 작업을 답한 응답자의 평균 */
  taskShare: { kind: TaskKind; pct: number }[]
  /** 많이 고른 순. 같으면 「기타」 가 뒤 */
  wishRanking: { tag: WishTag; count: number }[]
  /** 「기타」 로 적은 바람 — 글 그대로 */
  wishNotes: string[]
}

const krw = (tokens: number) => ({ cache66: Math.round((tokens / 1e6) * KRW_PER_MTOK.cache66), cache89: Math.round((tokens / 1e6) * KRW_PER_MTOK.cache89) })

/** 재직 구성원 기준. 구성원이 아닌 사람의 설문(퇴사 등)은 세지 않는다 */
export function companyEstimate(input: CompanyInput): CompanyEstimate {
  const byUser = new Map(input.surveys.map((s) => [s.userId, s]))
  const done: Metrics[] = []
  const inProgress: string[] = []
  const notStarted: string[] = []
  for (const m of input.members) {
    const s = byUser.get(m.id)
    if (s?.status === "SUBMITTED" && s.metrics) done.push(s.metrics)
    else if (s) inProgress.push(m.name)
    else notStarted.push(m.name)
  }
  const counted = done.filter((m) => m.monthlyTokens !== null)
  const monthlyTokens = counted.reduce((a, m) => a + (m.monthlyTokens ?? 0), 0)
  const grades: Record<Intensity, number> = { none: 0, light: 0, medium: 0, heavy: 0, unknown: 0 }
  const sub = { company: 0, personal: 0, both: 0, total: 0 }
  const wish = new Map<WishTag, number>()
  const share = new Map<TaskKind, number>()
  let withTasks = 0
  for (const m of done) {
    grades[m.intensity] += 1
    if (m.payer && m.payer !== "none" && m.monthlyFeeKrw) {
      sub[m.payer as "company" | "personal" | "both"] += m.monthlyFeeKrw
      sub.total += m.monthlyFeeKrw
    }
    for (const t of m.wishTags) wish.set(t, (wish.get(t) ?? 0) + 1)
    const entries = Object.entries(m.taskShare) as [TaskKind, number][]
    if (entries.length) {
      withTasks += 1
      for (const [k, pct] of entries) share.set(k, (share.get(k) ?? 0) + pct)
    }
  }
  const headcount = input.members.length
  const projectedTokens = counted.length ? Math.round((monthlyTokens / counted.length) * headcount) : null
  return {
    headcount,
    respondents: done.length,
    inProgress, notStarted,
    monthlyTokens,
    apiKrw: krw(monthlyTokens),
    unknownGrade: done.length - counted.length,
    projected: projectedTokens === null ? null : { monthlyTokens: projectedTokens, apiKrw: krw(projectedTokens) },
    subscriptionKrw: sub,
    grades,
    taskShare: [...share.entries()].map(([kind, sum]) => ({ kind, pct: Math.round(sum / withTasks) })).sort((a, b) => b.pct - a.pct),
    wishRanking: [...wish.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || Number(a.tag === "other") - Number(b.tag === "other") || a.tag.localeCompare(b.tag)),
    wishNotes: [...new Set(done.flatMap((m) => m.wishNotes))],
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
