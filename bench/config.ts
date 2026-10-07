// 벤치마크 그리드 설정 — 모델 축과 요금표.
//
// 한 항목이 "모델 ID + 생성 설정" 이다. 같은 모델의 thinking 켬/끔은 별도 항목으로 둔다.
// 요금은 2026-09-08 공식 페이지(ai.google.dev/gemini-api/docs/pricing · claude.com/pricing) 기준,
// USD / 100만 토큰. 바뀌면 여기만 고친다. 계획: mydocs/plans/2026-09-09-model-method-benchmark.md

export type Provider = "gemini" | "anthropic" | "openai-compat" | "claude-cli"

export interface Price {
  /** 입력 100만 토큰당 USD */
  input: number
  /** 출력(thinking 포함) 100만 토큰당 USD */
  output: number
  /** 캐시 읽기 100만 토큰당 USD. 없으면 input 과 같게 본다 */
  cachedInput?: number
  note?: string
}

export interface ModelSpec {
  /** 그리드에서 부르는 이름. 파일명·표에 그대로 쓴다 */
  key: string
  provider: Provider
  /** 벤더 API 에 보내는 모델 ID */
  id: string
  price: Price
  /** Gemini: thinkingConfig. 2.5 계열은 budget, 3.x 계열은 level */
  thinking?: { budget?: number; level?: "minimal" | "low" | "medium" | "high" }
  /** Anthropic: extended thinking 예산 토큰. 없으면 끔 */
  anthropicThinkingBudget?: number
  maxOutputTokens?: number
  /** 벤더 요청 사이 최소 간격(ms). 무료 티어 속도 제한용 */
  minIntervalMs?: number
  /** 이보다 긴 프롬프트는 보내지 않고 바로 실패로 적는다. 무료 티어의 분당 토큰 한도(TPM)를 넘는 요청은 재시도해도 안 된다 */
  maxPromptChars?: number
}

export const MODELS: ModelSpec[] = [
  // ── Gemini API · Gemma (무료 티어만, 속도 제한) ─────────────────
  // 무료 티어는 분당 토큰 한도가 있어 19k 토큰짜리 baseline 프롬프트가 429 로 튕겼다 (2026-09-09 실측).
  // 2만 자(약 1.2만 토큰) 넘는 프롬프트는 보내지 않는다 — baseline·stuff 는 Gemma 에서 "못 함" 으로 남는다.
  { key: "gemma-4-26b", provider: "gemini", id: "gemma-4-26b-a4b-it", price: { input: 0, output: 0, note: "Gemini API 무료 티어" }, minIntervalMs: 6000, maxPromptChars: 20_000 },
  { key: "gemma-4-31b", provider: "gemini", id: "gemma-4-31b-it", price: { input: 0, output: 0, note: "Gemini API 무료 티어" }, minIntervalMs: 6000, maxPromptChars: 20_000 },

  // ── Gemini Flash-Lite ───────────────────────────────────────
  { key: "gemini-2.5-flash-lite", provider: "gemini", id: "gemini-2.5-flash-lite", price: { input: 0.10, output: 0.40, cachedInput: 0.025 } },
  { key: "gemini-3.1-flash-lite", provider: "gemini", id: "gemini-3.1-flash-lite", price: { input: 0.25, output: 1.50 } },
  { key: "gemini-3.5-flash-lite", provider: "gemini", id: "gemini-3.5-flash-lite", price: { input: 0.30, output: 2.50 } },

  // ── Gemini Flash ────────────────────────────────────────────
  // 현행 옴니스 = gemini-2.5-flash, omnisAsk 는 thinking 기본(동적). 그대로 한 항목.
  { key: "gemini-2.5-flash", provider: "gemini", id: "gemini-2.5-flash", price: { input: 0.30, output: 2.50, cachedInput: 0.03 } },
  { key: "gemini-2.5-flash@nothink", provider: "gemini", id: "gemini-2.5-flash", price: { input: 0.30, output: 2.50, cachedInput: 0.03 }, thinking: { budget: 0 } },
  { key: "gemini-3.8-flash", provider: "gemini", id: "gemini-3.8-flash", price: { input: 0.75, output: 3.75, cachedInput: 0.075, note: "12/31 까지 할인가. 2027 부터 1.50 / 7.50" } },
  { key: "gemini-3.8-flash@low", provider: "gemini", id: "gemini-3.8-flash", price: { input: 0.75, output: 3.75, cachedInput: 0.075 }, thinking: { level: "low" } },

  // ── Anthropic (ANTHROPIC_API_KEY 없으면 건너뜀) ───────────────────
  { key: "claude-haiku-4.5", provider: "anthropic", id: "claude-haiku-4-5", price: { input: 1.00, output: 5.00, cachedInput: 0.10 } },
  { key: "claude-sonnet-5", provider: "anthropic", id: "claude-sonnet-5", price: { input: 2.00, output: 10.00, cachedInput: 0.20 } },

  // ── OpenAI 호환 (OPENAI_COMPAT_BASE_URL · OPENAI_COMPAT_API_KEY 없으면 건너뜀) ──
  // 예: Groq 의 Gemma, OpenRouter 의 GPT mini. id 와 요금은 쓰는 곳에 맞춰 바꾼다.
  // { key: "groq-gemma", provider: "openai-compat", id: "gemma2-9b-it", price: { input: 0.20, output: 0.20 } },
]

// wk-* : WeKnora 검색 기법 이식 R1a~R4 (bench/wk/search.ts) + hybrid 와 같은 단발 생성
// wk-agent : WeKnora 식 ReAct 에이전트 (bench/agent/)
// weknora-rag · weknora-agent : 로컬 Docker 실물 WeKnora v0.8.2 의 빠른 답변 · 스마트 추론 (bench/wk-real/)
export const METHODS = ["baseline", "vector", "hybrid", "stuff", "route", "native", "wk-r1a", "wk-r1b", "wk-r2", "wk-r3", "wk-r4", "wk-agent", "weknora-rag", "weknora-agent"] as const
export type MethodName = (typeof METHODS)[number]

/**
 * 심판 모델. 답변 채점에만 쓴다. 비용은 결과에 따로 적는다.
 * 기본 gemini-2.5-pro. 과부하로 느리면 BENCH_JUDGE=gemini-3.8-flash 처럼 바꾼다.
 * (smoke 에서 2.5-pro 가 503 재시도로 5분 걸린 적이 있다 — 2026-09-09)
 */
const JUDGES: Record<string, ModelSpec> = {
  // 채점은 단순한 일이라 thinking 을 1024 로 묶는다 — smoke 에서 1건에 21원(답변보다 비쌈)이 나왔다.
  "gemini-2.5-pro": { key: "judge:gemini-2.5-pro", provider: "gemini", id: "gemini-2.5-pro", price: { input: 1.25, output: 10.00 }, maxOutputTokens: 2048, thinking: { budget: 1024 } },
  "gemini-3.8-flash": { key: "judge:gemini-3.8-flash", provider: "gemini", id: "gemini-3.8-flash", price: { input: 0.75, output: 3.75 }, maxOutputTokens: 2048 },
  "claude-sonnet-5": { key: "judge:claude-sonnet-5", provider: "anthropic", id: "claude-sonnet-5", price: { input: 2.00, output: 10.00 }, maxOutputTokens: 2048 },
  // 작업지시자의 Claude 구독 — Claude Code 헤드리스 `claude -p` (bench/claude-cli.ts). id 는 --model 값.
  // 청구가 없어 요금은 0. API 요금표 환산액(total_cost_usd)은 결과 행 judgeNotionalUsd 에 따로 남긴다.
  // 문항 BENCH_JUDGE_BATCH(기본 10)개를 한 호출로 묶어 채점한다 (judge.ts judgeMany).
  "claude-sonnet-cli": { key: "judge:claude-sonnet-cli", provider: "claude-cli", id: "sonnet", price: { input: 0, output: 0, note: "Claude 구독 (claude -p)" } },
  "claude-haiku-cli": { key: "judge:claude-haiku-cli", provider: "claude-cli", id: "haiku", price: { input: 0, output: 0, note: "Claude 구독 (claude -p)" } },
}
const judgeName = process.env.BENCH_JUDGE ?? "gemini-2.5-pro"
if (!JUDGES[judgeName]) throw new Error(`BENCH_JUDGE 는 ${Object.keys(JUDGES).join(" · ")} 중 하나`)
export const JUDGE_MODEL: ModelSpec = JUDGES[judgeName]
/** 결과 행 judgeModel · meta.judge 에 남기는 심판 이름. 구독 심판은 "claude-cli:sonnet" 처럼 앞에 붙여 API 심판과 구별한다 */
export const JUDGE_LABEL = JUDGE_MODEL.provider === "claude-cli" ? `claude-cli:${JUDGE_MODEL.id}` : JUDGE_MODEL.id

/**
 * 임베딩 단가 — gemini-embedding-001, 입력 100만 토큰당 USD.
 * 확인 필요: 2026 공식 단가를 확인하지 못해 0.15 로 둔다. 비용 장부(ledger.ts)의 추정치에만 쓴다.
 */
export const EMBEDDING_PRICE_USD_PER_M = 0.15

export const KRW_PER_USD = Number(process.env.BENCH_KRW_PER_USD ?? 1380)

export function usdToKrw(usd: number): number {
  return Math.round(usd * KRW_PER_USD * 100) / 100
}

export function modelAvailable(m: ModelSpec): { ok: boolean; why?: string } {
  switch (m.provider) {
    case "gemini":
      return process.env.GEMINI_API_KEY ? { ok: true } : { ok: false, why: "GEMINI_API_KEY 없음" }
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY ? { ok: true } : { ok: false, why: "ANTHROPIC_API_KEY 없음" }
    case "openai-compat":
      return process.env.OPENAI_COMPAT_BASE_URL && process.env.OPENAI_COMPAT_API_KEY
        ? { ok: true }
        : { ok: false, why: "OPENAI_COMPAT_BASE_URL · OPENAI_COMPAT_API_KEY 없음" }
    case "claude-cli":
      // 키가 아니라 로그인된 claude CLI 를 쓴다. 로그인이 안 됐으면 첫 호출이 오류로 알려 준다
      return { ok: true }
  }
}
