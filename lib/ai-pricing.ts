// AI 요금표 — 한 곳. 사용 기록(AiUsage)의 원 환산과 에이전트 실행당 원 상한이 여기서 나온다.
// 순수 모듈(prisma 없음) — Workflow 안에서도 부른다. 시험: lib/ai-pricing.test.ts
//
// 단가는 100만 토큰당 달러. 캐시 입력은 캐시에서 읽힌 입력 토큰의 단가(쓰기 할증은 넣지 않았다).
// 출처 날짜가 지난 값은 그 날짜 그대로 둔다 — 바꿀 때 날짜와 출처를 함께 고친다.

export interface ModelPrice {
  input: number
  cachedInput: number
  output: number
  /** 어디서 언제 확인했나 */
  source: string
}

/** 원/달러. 0단계 벤치(mydocs/working/2026-10-28-agent-bench.md)와 같은 값 */
export const KRW_PER_USD = 1380

const OPENAI = "developers.openai.com/api/docs/pricing, 2026-10-28"
const ANTHROPIC = "claude-api 스킬 요금표(2026-10-06 캐시), 0단계 벤치 bench/config.ts 2026-10-28"
const GOOGLE = "bench/config.ts 2026-09-08 — 12/31 까지 할인가, 2027 부터 1.50 / 7.50"

/** key = "vendor:model" (lib/ai-models.ts 의 모양) */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  "openai:gpt-6.1-sol": { input: 2.0, cachedInput: 0.1, output: 10.0, source: OPENAI },
  "openai:gpt-6.1-terra": { input: 1.0, cachedInput: 0.05, output: 5.0, source: OPENAI },
  "openai:gpt-6-luna": { input: 0.1, cachedInput: 0.01, output: 0.5, source: OPENAI },
  "anthropic:claude-sonnet-5-5": { input: 2.0, cachedInput: 0.2, output: 10.0, source: ANTHROPIC },
  "anthropic:claude-haiku-5-5": { input: 0.1, cachedInput: 0.01, output: 0.5, source: ANTHROPIC },
  "anthropic:claude-opus-5-5": { input: 4.0, cachedInput: 0.2, output: 20.0, source: ANTHROPIC },
  "google:gemini-3.8-flash": { input: 0.75, cachedInput: 0.075, output: 3.75, source: GOOGLE },
}

export interface TokenUsage {
  /** 입력 전체(캐시 읽기 포함) */
  inputTokens: number
  cachedInputTokens: number
  /** 출력 전체(추론 포함) */
  outputTokens: number
}

export interface Cost {
  usd: number
  krw: number
  /** 요금표에 없는 모델이면 false — 값은 0 */
  priced: boolean
}

export function costOf(modelKey: string, u: TokenUsage): Cost {
  const p = MODEL_PRICES[modelKey]
  if (!p) return { usd: 0, krw: 0, priced: false }
  const cached = Math.min(Math.max(u.cachedInputTokens, 0), Math.max(u.inputTokens, 0))
  const fresh = Math.max(u.inputTokens - cached, 0)
  const usd = (fresh * p.input + cached * p.cachedInput + Math.max(u.outputTokens, 0) * p.output) / 1e6
  return { usd, krw: usd * KRW_PER_USD, priced: true }
}
