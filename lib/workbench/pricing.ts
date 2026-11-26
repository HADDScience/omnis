// 작업용 컴퓨터 비용 — 세션 사용량(토큰 · 실행 시간) → 달러 · 원. 데이터만 다룬다.
//
// 단가: platform.claude.com/docs/en/about-claude/pricing(2026-11 확인, claude-api 스킬 표).
// 캐시 쓰기는 5분 1.25배 · 1시간 2배, 캐시 읽기는 모델마다 표에 적힌 값. 세션 실행 $0.08/시간(Managed Agents).
// Anthropic 이 주는 usage.list_cost 가 있으면 그것을 쓴다(정가 기준, 센트). 없거나 0 이면 이 표로 계산한다.

export interface ClaudePrice {
  input: number
  output: number
  cacheRead: number
}

/** 100만 토큰당 달러 */
export const CLAUDE_PRICES: Record<string, ClaudePrice> = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
}

export const SESSION_USD_PER_HOUR = 0.08

export interface SessionUsageLike {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_creation?: { ephemeral_5m_input_tokens?: number | null; ephemeral_1h_input_tokens?: number | null } | null
  active_seconds?: number | null
  list_cost?: { amount: string; currency: string } | null
}

export interface WorkbenchCost {
  inputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
  outputTokens: number
  activeSeconds: number
  usd: number
  krw: number
  /** list_cost(Anthropic) 를 썼나, 이 표로 계산했나 */
  source: "list_cost" | "table"
}

const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0)

export function sessionCost(model: string, u: SessionUsageLike | null | undefined, krwPerUsd: number): WorkbenchCost {
  const p = CLAUDE_PRICES[model] ?? CLAUDE_PRICES["claude-sonnet-5-5"]
  const w5 = n(u?.cache_creation?.ephemeral_5m_input_tokens)
  const w1 = n(u?.cache_creation?.ephemeral_1h_input_tokens)
  const base = {
    inputTokens: n(u?.input_tokens),
    cacheWriteTokens: w5 + w1,
    cacheReadTokens: n(u?.cache_read_input_tokens),
    outputTokens: n(u?.output_tokens),
    activeSeconds: n(u?.active_seconds),
  }
  const table =
    (base.inputTokens * p.input + w5 * p.input * 1.25 + w1 * p.input * 2 + base.cacheReadTokens * p.cacheRead + base.outputTokens * p.output) / 1e6 +
    (base.activeSeconds / 3600) * SESSION_USD_PER_HOUR
  const listCents = u?.list_cost?.currency === "USD" ? Number(u.list_cost.amount) : NaN
  const useList = Number.isFinite(listCents) && listCents > 0
  const usd = useList ? listCents / 100 : table
  return { ...base, usd: round6(usd), krw: Math.round(usd * krwPerUsd), source: useList ? "list_cost" : "table" }
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6

/** 원 → 세션 예산(달러 센트, 정수 문자열). 0 이하는 1센트로 */
export function budgetCents(krw: number, krwPerUsd: number): string {
  return String(Math.max(1, Math.floor((krw / krwPerUsd) * 100)))
}

/** 시작 카드에 보이는 예상 — 계획 v3 3-2 표(스킬 없음, Sonnet). 실측 전 가정이다 */
export const ESTIMATE_KRW = { light: 380, standard: 1_130, heavy: 2_790 } as const
export type TaskSize = keyof typeof ESTIMATE_KRW

export function estimateKrw(size: TaskSize, model: string): number {
  const mult = model.includes("opus") ? 2 : model.includes("haiku") ? 0.1 : 1
  return Math.round(ESTIMATE_KRW[size] * mult)
}
