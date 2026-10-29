// 기능별 AI 모델 설정 — 한 곳. 바꿀 때는 여기 기본값을 고치거나 환경변수로 덮는다.
// 순수 모듈(prisma 없음). 계획: mydocs/plans/2026-10-28-omnis-messenger-agent.md 3단계 「모델 갈아 끼우기」
//
// 모델은 각 사 키로 직접 붙는다(@ai-sdk/openai · anthropic · google, AI Gateway 를 쓰지 않는다).
// 기존 Gemini 기능(카드 생성 · 임베딩 · 재구성 · 옴니스 질문 /omnis/ask · MCP ask_omnis)은 아직 lib/ai.ts 와
// 각자의 환경변수(OMNIS_ASK_MODEL …)를 쓴다 — 이번(3단계)에는 옮기지 않았다.
// 바꾸기 전에 bench/agent 를 같은 과제로 다시 돌려 비교한다.

export type AiVendor = "openai" | "anthropic" | "google"
export type ReasoningEffort = "low" | "medium" | "high"

export interface ModelChoice {
  vendor: AiVendor
  model: string
  /** OpenAI reasoningEffort · Anthropic effort. Gemini 는 무시 */
  reasoning?: ReasoningEffort
}

export type AiFeature = "agent"

const DEFAULTS: Record<AiFeature, ModelChoice> = {
  // 0단계 실측 1위(완수율 100% · 건당 15.2원) — mydocs/working/2026-10-28-agent-bench.md
  agent: { vendor: "openai", model: "gpt-6.1-sol", reasoning: "medium" },
}

/** 덮어쓰는 환경변수. 값은 "vendor:model" (예: anthropic:claude-sonnet-5-5) */
const ENV: Record<AiFeature, { model: string; reasoning: string }> = {
  agent: { model: "OMNIS_AGENT_MODEL", reasoning: "OMNIS_AGENT_REASONING" },
}

const VENDORS: readonly AiVendor[] = ["openai", "anthropic", "google"]
const EFFORTS: readonly ReasoningEffort[] = ["low", "medium", "high"]

/** env 를 인자로 받는다 — 시험이 process.env 를 건드리지 않게 */
export function modelFor(feature: AiFeature, env: Record<string, string | undefined> = process.env): ModelChoice {
  const base = DEFAULTS[feature]
  const raw = env[ENV[feature].model]?.trim()
  let choice = base
  if (raw) {
    const [vendor, ...rest] = raw.split(":")
    const model = rest.join(":")
    if (!VENDORS.includes(vendor as AiVendor) || !model) {
      throw new Error(`${ENV[feature].model} 는 "vendor:model" 이어야 합니다 (vendor = ${VENDORS.join(" · ")}): ${raw}`)
    }
    choice = { vendor: vendor as AiVendor, model, reasoning: base.reasoning }
  }
  const effort = env[ENV[feature].reasoning]?.trim()
  if (effort) {
    if (!EFFORTS.includes(effort as ReasoningEffort)) throw new Error(`${ENV[feature].reasoning} 는 ${EFFORTS.join(" · ")} 중 하나입니다: ${effort}`)
    choice = { ...choice, reasoning: effort as ReasoningEffort }
  }
  return choice
}

export const modelKey = (c: Pick<ModelChoice, "vendor" | "model">) => `${c.vendor}:${c.model}`

/** 에이전트 실행당 상한. 확인 뒤 이어 간 것까지 한 실행으로 센다 */
export interface AgentLimits {
  /** 모델 호출 수 */
  maxTurns: number
  /** 원(요금표 환산) */
  maxKrw: number
}

export function agentLimits(env: Record<string, string | undefined> = process.env): AgentLimits {
  const num = (name: string, fallback: number) => {
    const n = Number(env[name])
    return Number.isFinite(n) && n > 0 ? n : fallback
  }
  return { maxTurns: Math.floor(num("OMNIS_AGENT_MAX_TURNS", 12)), maxKrw: num("OMNIS_AGENT_MAX_KRW", 200) }
}
