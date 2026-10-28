// 라우터 — Jev(TypeSafe 의 결정 전용 모델)가 요청을 simple / complex 로 나누고, 코드가 실행 모델을 고른다.
//
// 계획서 2026-10-28-omnis-messenger-agent.md 0-b 절. 판단 기준: 전부-sol 보다 완수율이 떨어지지 않으면서
// 건당 원(Jev 포함)이 30% 이상 줄면 3단계 런타임에 넣는다.
//
// API (2026-10-28 공식 문서 확인):
//   TypeSafe 직접   POST https://api.typesafe.ai/v1/systemone            Authorization: Bearer $JEV_API_KEY
//                   모델 jev-1.14.0 (jev-latest 가 가리키는 버전). docs.typesafe.ai/models.md ·
//                   docs.typesafe.ai/api/system-one.md
//   AI Gateway      POST https://ai-gateway.vercel.sh/typesafe/v1/systemone  Authorization: Bearer $AI_GATEWAY_API_KEY
//                   모델 typesafe-ai/jev-1.14.0. vercel.com/docs/ai-gateway/sdks-and-apis/typesafe
//   요청  { model, state, questions: { <이름>: { type: "choice", instructions, criteria: { 선택지: 설명 } } } }
//   응답  { model, answers: { <이름>: { type: "choice", choice, confidence, probabilities } }, usage: { input_tokens, output_tokens } }
//   요금  입력 100만 토큰당 $0.042, 출력 무료 (models.md · Gateway /v1/models 둘 다 같은 값)
//   이유(reason) 칸은 응답에 없다 — Jev 는 글을 생성하지 않는다. 그래서 받지 않는다.
//
// 버전을 고정한다: 문서가 "확신도 기준을 맞춰 둔 버전이 있으면 alias 대신 그 버전 ID 를 보내라" 고 한다.
//
// 공정성: Jev 에는 사용자 요청 원문만 state 로 준다. 과제 유형 라벨·정답·rubric 은 주지 않는다.
// instructions·criteria 는 모든 과제에 같은 고정 문장이다.
//
// 확신도 기준 기본 0.7. 문서는 단일 권장값을 두지 않는다("도메인과 위험에 따라 정하라",
// 예시는 0.5 · 0.6 하한) → 지시서의 기본값 0.7 을 쓴다. 두 선택지 Choice 의 confidence 는 |2p − 1| 이라
// 0.7 은 한쪽 확률 0.85 이상이다. 한국어는 영어보다 정확도가 낮다고 문서가 적고 있어 확신도를 보고 가르는 게 맞다.
import { fetchWithRetry, now } from "../providers"

export const JEV_PRICE_USD_PER_MTOK = 0.042

export type JevRoute = "direct" | "gateway" | "dry"
export type Difficulty = "simple" | "complex"
export type Fallback = "low_confidence" | "malformed" | "error"

export interface RouterConfig {
  route: JevRoute
  url: string
  model: string
  apiKey: string
  /** 출처 설명 (값은 담지 않는다) */
  keyLabel: string
  threshold: number
  cheap: string
  strong: string
}

export interface RouterDecision {
  router: "jev"
  route: JevRoute
  jevModel: string
  /** Jev 가 고른 등급. 응답이 깨졌거나 호출이 실패하면 null */
  label: Difficulty | null
  confidence: number | null
  probabilities: Record<string, number> | null
  threshold: number
  /** 규칙의 두 갈래 (모델 키) */
  cheap: string
  strong: string
  /** 실제로 실행에 쓴 모델 키 */
  chosen: string
  fallback?: Fallback
  error?: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  ms: number
}

/** 고정 질문 — 과제마다 바꾸지 않는다. 문서상 영어 지시문이 가장 정확하다 */
export const DIFFICULTY_QUESTION = {
  type: "choice",
  instructions:
    "The state is a request that a company employee sent to an AI work agent. The agent can read company data " +
    "(tasks, members, CRM, company records, patents) through tools and can propose changes that a human confirms. " +
    "How hard is it for the agent to handle this request correctly?",
  criteria: {
    simple: "One lookup or one clearly specified action. Everything needed is stated; little reasoning is required.",
    complex:
      "Needs several lookups combined, careful counting or filtering, drafting a document or file, checking for " +
      "duplicates, resolving an unclear target, or judging whether the request should be declined.",
  },
} as const

export function routerConfigFromEnv(opts: { threshold: number; cheap: string; strong: string; dryRun: boolean }): RouterConfig {
  const base = { threshold: opts.threshold, cheap: opts.cheap, strong: opts.strong }
  if (opts.dryRun) return { ...base, route: "dry", url: "(dry-run 가짜 응답)", model: "jev-1.14.0", apiKey: "", keyLabel: "없음 (dry-run)" }
  if (process.env.JEV_API_KEY) {
    return { ...base, route: "direct", url: "https://api.typesafe.ai/v1/systemone", model: "jev-1.14.0", apiKey: process.env.JEV_API_KEY, keyLabel: "JEV_API_KEY (TypeSafe 직접)" }
  }
  if (process.env.AI_GATEWAY_API_KEY) {
    return { ...base, route: "gateway", url: "https://ai-gateway.vercel.sh/typesafe/v1/systemone", model: "typesafe-ai/jev-1.14.0", apiKey: process.env.AI_GATEWAY_API_KEY, keyLabel: "AI_GATEWAY_API_KEY (Vercel AI Gateway)" }
  }
  throw new Error("라우터 키가 없다: .env 에 JEV_API_KEY(TypeSafe 직접) 또는 AI_GATEWAY_API_KEY(Vercel AI Gateway)")
}

export interface SystemOneBody {
  model: string
  state: string
  questions: { difficulty: typeof DIFFICULTY_QUESTION }
}

/** 원시 응답(JSON). 형식 검사는 decide 가 한다 */
export type JevSend = (body: SystemOneBody) => Promise<unknown>

function httpSend(cfg: RouterConfig): JevSend {
  return async (body) => {
    // 429 · 529(과부하)는 재시도 — 문서 api/errors.md 가 지수 백오프를 권한다. fetchWithRetry 가 둘 다 다룬다.
    const res = await fetchWithRetry(
      cfg.url,
      { method: "POST", headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) },
      "jev",
      4
    )
    return res.json()
  }
}

/** 응답이 약속한 모양인지 — 아니면 malformed 로 강한 모델에 보낸다 */
function parseAnswer(raw: unknown): { label: Difficulty; confidence: number; probabilities: Record<string, number>; inputTokens: number; outputTokens: number } | null {
  const r = raw as { answers?: { difficulty?: { type?: string; choice?: unknown; confidence?: unknown; probabilities?: unknown } }; usage?: { input_tokens?: unknown; output_tokens?: unknown } }
  const a = r?.answers?.difficulty
  if (!a || a.type !== "choice") return null
  if (a.choice !== "simple" && a.choice !== "complex") return null
  if (typeof a.confidence !== "number" || !(a.confidence >= 0 && a.confidence <= 1)) return null
  const probs = (a.probabilities && typeof a.probabilities === "object" ? a.probabilities : {}) as Record<string, number>
  return {
    label: a.choice, confidence: a.confidence, probabilities: probs,
    inputTokens: typeof r.usage?.input_tokens === "number" ? r.usage.input_tokens : 0,
    outputTokens: typeof r.usage?.output_tokens === "number" ? r.usage.output_tokens : 0,
  }
}

/**
 * 결정 → 모델. 규칙은 여기 한 곳에 있다.
 *   호출 실패 → strong (error) · 형식이 다름 → strong (malformed) · 확신도 < 기준 → strong (low_confidence)
 *   simple → cheap · complex → strong
 */
export async function decide(userPrompt: string, cfg: RouterConfig, send?: JevSend): Promise<RouterDecision> {
  const body: SystemOneBody = { model: cfg.model, state: userPrompt, questions: { difficulty: DIFFICULTY_QUESTION } }
  const base = { router: "jev" as const, route: cfg.route, jevModel: cfg.model, threshold: cfg.threshold, cheap: cfg.cheap, strong: cfg.strong }
  const t0 = now()
  let raw: unknown
  try {
    raw = await (send ?? httpSend(cfg))(body)
  } catch (err) {
    return { ...base, label: null, confidence: null, probabilities: null, chosen: cfg.strong, fallback: "error", error: String(err).slice(0, 300), inputTokens: 0, outputTokens: 0, costUsd: 0, ms: Math.round(now() - t0) }
  }
  const ms = Math.round(now() - t0)
  const p = parseAnswer(raw)
  if (!p) {
    return { ...base, label: null, confidence: null, probabilities: null, chosen: cfg.strong, fallback: "malformed", error: JSON.stringify(raw).slice(0, 300), inputTokens: 0, outputTokens: 0, costUsd: 0, ms }
  }
  const costUsd = (p.inputTokens * JEV_PRICE_USD_PER_MTOK) / 1e6
  const common = { ...base, label: p.label, confidence: p.confidence, probabilities: p.probabilities, inputTokens: p.inputTokens, outputTokens: p.outputTokens, costUsd, ms }
  if (p.confidence < cfg.threshold) return { ...common, chosen: cfg.strong, fallback: "low_confidence" }
  return { ...common, chosen: p.label === "simple" ? cfg.cheap : cfg.strong }
}

let fakeCalls = 0

/**
 * dry-run 용 가짜 Jev. 과제 라벨을 보지 않고 부른 순서대로 다섯 갈래를 돌아가며 낸다:
 *   simple 확신 높음 · complex 확신 높음 · simple 확신 낮음(→ strong) · 형식이 다른 응답(→ strong) · 호출 오류(→ strong)
 */
export function fakeJevSend(): JevSend {
  return async (body) => {
    const h = fakeCalls++
    const inTok = Math.ceil(body.state.length + JSON.stringify(body.questions).length / 4)
    const usage = { input_tokens: inTok, output_tokens: 2 }
    const answer = (choice: Difficulty, p: number) => ({
      model: body.model, usage,
      answers: { difficulty: { type: "choice", choice, confidence: Math.abs(2 * p - 1), probabilities: { [choice]: p, [choice === "simple" ? "complex" : "simple"]: 1 - p } } },
    })
    switch (h % 5) {
      case 0: return answer("simple", 0.95)
      case 1: return answer("complex", 0.9)
      case 2: return answer("simple", 0.7) //  confidence 0.4 < 기준
      case 3: return { model: body.model, answers: { difficulty: { type: "noul", noul: 0.5 } }, usage } // 형식이 다름
      default: throw new Error("jev: 529 Overloaded (dry-run 가짜 오류)")
    }
  }
}
