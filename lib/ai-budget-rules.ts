// AI 비용 상한 — 순수 규칙(prisma 없음). 시험: lib/ai-budget-rules.test.ts
//
// 「작게 시작해 쓰는 만큼 늘린다」(작업지시자 2026-11-10). 회사 전체가 나눠 쓰는 하루 상한 대신
//   사람별 하루 상한(원) + 회사 월 상한(원). 기본값은 env, 관리자 화면 값(AppSetting ai_budget)이 있으면 그것.
//   사람별 예외 상한(users)은 그 사람의 하루 상한을 바꾼다.
// 원천은 AiUsage.costKrw(에이전트 · 사진 설명 · Gemini 호출 전부, lib/gemini-usage.ts).
// 계획: mydocs/plans/2026-11-10-ai-budget.md

export interface BudgetSettings {
  /** 1인 하루 상한(원) */
  userDailyKrw: number
  /** 회사 월 상한(원) */
  monthlyKrw: number
  /** 사람별 하루 상한 예외 — userId → 원 */
  users: Record<string, number>
}

export const DEFAULT_USER_DAILY_KRW = 1_000
export const DEFAULT_MONTHLY_KRW = 110_000
/** 알림 단계(월 상한 대비 %) */
export const ALERT_LEVELS = [80, 100] as const
export type AlertLevel = (typeof ALERT_LEVELS)[number]

const positive = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v.trim()) : typeof v === "number" ? v : NaN
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

/** env 기본값 — OMNIS_AI_USER_DAILY_KRW · OMNIS_AI_MONTHLY_KRW. 비었거나 이상하면 코드 기본값 */
export function budgetDefaults(env: Record<string, string | undefined> = process.env): BudgetSettings {
  return {
    userDailyKrw: positive(env.OMNIS_AI_USER_DAILY_KRW) ?? DEFAULT_USER_DAILY_KRW,
    monthlyKrw: positive(env.OMNIS_AI_MONTHLY_KRW) ?? DEFAULT_MONTHLY_KRW,
    users: {},
  }
}

/** 저장된 값(관리자 화면)을 기본값 위에 얹는다. 모양이 틀린 칸은 버리고 기본값을 쓴다 */
export function mergeBudget(defaults: BudgetSettings, stored: unknown): BudgetSettings {
  const s = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>
  const users: Record<string, number> = {}
  if (s.users && typeof s.users === "object") {
    for (const [id, v] of Object.entries(s.users as Record<string, unknown>)) {
      const n = positive(v)
      if (n !== null && id) users[id] = n
    }
  }
  return {
    userDailyKrw: positive(s.userDailyKrw) ?? defaults.userDailyKrw,
    monthlyKrw: positive(s.monthlyKrw) ?? defaults.monthlyKrw,
    users,
  }
}

/** 이 사람의 하루 상한 */
export const userDailyLimit = (b: BudgetSettings, userId: string) => b.users[userId] ?? b.userDailyKrw

const KST = 9 * 3600_000

/** 한국 시각 이번 달 1일 0시(UTC Date) */
export function kstMonthStart(now: Date = new Date()): Date {
  const k = new Date(now.getTime() + KST)
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), 1) - KST)
}

/** "2026-11" — 알림 표시 · 화면 */
export function kstMonthKey(now: Date = new Date()): string {
  const k = new Date(now.getTime() + KST)
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, "0")}`
}

/** "2026-11-10" */
export function kstDayKey(d: Date): string {
  return new Date(d.getTime() + KST).toISOString().slice(0, 10)
}

export type BudgetKind = "user_daily" | "monthly"

export interface BudgetBlock {
  kind: BudgetKind
  /** 지금 상한 */
  limitKrw: number
  usedKrw: number
  /** 관리자면 그 자리에서 올릴 수 있다 */
  canRaise: boolean
  /** 올리기 단추가 제안하는 새 상한 */
  suggestKrw: number
  /** 하루 상한이면 그 사람 */
  userId?: string
  /** 원 → 대화 수 환산 기준(화면이 「약 n번」 을 쓴다) */
  basis?: RunCostBasis
}

/** 올리기 제안 — 지금 상한의 1.5배를 보기 좋은 값으로(하루는 500원, 월은 10,000원 단위로 올림) */
export function suggestRaise(kind: BudgetKind, limitKrw: number): number {
  const step = kind === "user_daily" ? 500 : 10_000
  return Math.max(Math.ceil((limitKrw * 1.5) / step) * step, limitKrw + step)
}

/**
 * 새 옴니스 실행을 받을지. 막으면 429 와 화면에 보일 문장 · 올리기 정보.
 * 회사 월 상한을 먼저 본다 — 그쪽이 닿았으면 사람별 상한을 올려도 소용없다.
 */
export function budgetRefusal(
  used: { userTodayKrw: number; monthKrw: number },
  b: BudgetSettings,
  who: { userId: string; isAdmin: boolean },
  basis?: RunCostBasis,
): { status: 429; error: string; budget: BudgetBlock } | null {
  // 「1,000원 · 보통 대화 약 59번」 — 금액만으로는 얼마나 쓴 것인지 감이 오지 않는다
  const sized = (krw: number) => `${krw.toLocaleString("ko-KR")}원${basis ? ` · 보통 대화 약 ${runsFor(krw, basis).typical.toLocaleString("ko-KR")}번${basis.estimated ? "(추정)" : ""}` : ""}`
  if (used.monthKrw >= b.monthlyKrw) {
    return {
      status: 429,
      error: `이번 달 회사 AI 사용 한도(${sized(b.monthlyKrw)})에 도달했어요. ${who.isAdmin ? "아래에서 한도를 올릴 수 있어요." : "관리자에게 한도를 올려 달라고 요청해 주세요."}`,
      budget: { kind: "monthly", limitKrw: b.monthlyKrw, usedKrw: used.monthKrw, canRaise: who.isAdmin, suggestKrw: suggestRaise("monthly", b.monthlyKrw), ...(basis ? { basis } : {}) },
    }
  }
  const limit = userDailyLimit(b, who.userId)
  if (used.userTodayKrw >= limit) {
    return {
      status: 429,
      error: `오늘 AI 사용 한도(${sized(limit)})에 도달했어요. 내일 0시에 다시 열려요.${who.isAdmin ? " 아래에서 한도를 올릴 수 있어요." : " 급하면 관리자에게 요청해 주세요."}`,
      budget: { kind: "user_daily", limitKrw: limit, usedKrw: used.userTodayKrw, canRaise: who.isAdmin, suggestKrw: suggestRaise("user_daily", limit), userId: who.userId, ...(basis ? { basis } : {}) },
    }
  }
  return null
}

/** 월 누적이 넘은 알림 단계 중 아직 보내지 않은 것 */
export function dueAlertLevels(monthKrw: number, monthlyKrw: number, sent: readonly number[]): AlertLevel[] {
  if (monthlyKrw <= 0) return []
  const pct = (monthKrw / monthlyKrw) * 100
  return ALERT_LEVELS.filter((l) => pct >= l && !sent.includes(l))
}

/** 상한 대비 % — 화면용(소수 없이, 상한 0 이면 null) */
export const percentOf = (used: number, limit: number): number | null => (limit > 0 ? Math.round((used / limit) * 100) : null)

// ─── 원 → 대화 수 환산 ─────────────────────────────────────────────
// 「하루 1,000원」 이 얼마만큼인지 — 운영 실측(최근 30일 옴니스 대화 1건 비용)의 중앙값 = 보통, 90%값 = 긴 작업.
// 표본이 적으면 기본값(2026-11 벤치 · 초기 운영 기준)을 쓰고 「추정」 을 붙인다.

export const RUN_COST_MIN_SAMPLES = 20
export const DEFAULT_RUN_COST = { typical: 16.9, long: 54 } as const

export interface RunCostBasis {
  /** 보통 대화 1건(원) — 중앙값 */
  typical: number
  /** 긴 작업 1건(원) — 90%값 */
  long: number
  samples: number
  /** 표본이 모자라 기본값을 썼다 */
  estimated: boolean
}

/** 정렬된 값의 분위수(선형 보간) */
export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/** 대화 1건 비용들 → 환산 기준. 0 이하 · 숫자 아닌 값은 버린다 */
export function runCostBasis(costs: number[]): RunCostBasis {
  const xs = costs.filter((c) => Number.isFinite(c) && c > 0).sort((a, b) => a - b)
  if (xs.length < RUN_COST_MIN_SAMPLES) return { ...DEFAULT_RUN_COST, samples: xs.length, estimated: true }
  const typical = quantile(xs, 0.5)
  // 긴 작업이 보통보다 싸게 나오는 일은 없게
  return { typical, long: Math.max(quantile(xs, 0.9), typical), samples: xs.length, estimated: false }
}

/** 이 금액이면 대화 몇 번 — 내림(「약 n번」) */
export function runsFor(krw: number, basis: RunCostBasis): { typical: number; long: number } {
  const n = (per: number) => (per > 0 ? Math.max(Math.floor(krw / per), 0) : 0)
  return { typical: n(basis.typical), long: n(basis.long) }
}

/** 한 줄 — 「옴니스 대화 약 59번(보통) · 긴 작업 약 18번」. 짧게(short)면 「보통 약 59번 · 긴 작업 약 18번」 */
export function runsLabel(krw: number, basis: RunCostBasis, short = false): string {
  const r = runsFor(krw, basis)
  const n = (x: number) => x.toLocaleString("ko-KR")
  return short
    ? `보통 약 ${n(r.typical)}번 · 긴 작업 약 ${n(r.long)}번`
    : `옴니스 대화 약 ${n(r.typical)}번(보통) · 긴 작업 약 ${n(r.long)}번`
}
