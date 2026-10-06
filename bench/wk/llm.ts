// 검색 단계의 LLM 호출 — 질의 이해(R2) · 리랭크(R3). 둘 다 gemini-3.5-flash-lite 한 번씩.
//
// 호출은 bench/providers.ts 의 complete 를 쓴다 (사용량·재시도·시간이 생성 쪽과 같은 모양으로 남는다).
// 비용은 config.ts 요금표의 flash-lite 단가로 센다.
import { MODELS, type ModelSpec } from "../config"
import { complete, costUsd, type Usage } from "../providers"

/**
 * flash-lite, thinking 최소. 3.x 계열은 thinkingBudget 0 을 400 으로 거절해서(2026-10-06 실측)
 * 가장 낮은 thinkingLevel "minimal" 을 준다.
 */
const base = MODELS.find((m) => m.key === "gemini-3.5-flash-lite")
if (!base) throw new Error("config.ts 에 gemini-3.5-flash-lite 가 없습니다")
export const LITE: ModelSpec = { ...base, key: "wk:gemini-3.5-flash-lite", thinking: { level: "minimal" } }

export interface LlmCall { usage: Usage; costUsd: number; ms: number }

/** 코드펜스·앞뒤 말을 걷고 첫 { 부터 마지막 } 까지를 JSON 으로 읽는다. 실패하면 null */
function parseJsonLoose(text: string): Record<string, unknown> | null {
  const s = text.indexOf("{")
  const e = text.lastIndexOf("}")
  if (s < 0 || e <= s) return null
  try { return JSON.parse(text.slice(s, e + 1)) as Record<string, unknown> } catch { return null }
}

// ─── 질의 이해 (R2) ──────────────────────────────────────────────
//
// WeKnora query_understand.go: 대화 이력 + 질문으로 rewrite_query · intent · (이미지 설명) 을 JSON 으로 받는다.
// 여기선 단발 질문이라 이력이 없고, 의도는 기록만 한다 — WeKnora 는 의도별로 시스템 프롬프트를 바꾼다
// (applyIntentPromptOverride). 생성 프롬프트는 기존 hybrid 와 같아야 하므로 바꾸지 않는다.

export const INTENTS = ["lookup", "aggregate", "status", "other"] as const
export type Intent = (typeof INTENTS)[number]

export async function understandQuery(question: string): Promise<LlmCall & { rewrite: string; intent: Intent }> {
  const prompt = `사내 업무 검색 시스템의 질의 분석기입니다. 아래 질문을 검색에 쓰기 좋게 다시 쓰고 의도를 분류하세요.

- rewrite: 고유명사·제품명·사람 이름·번호·숫자는 글자 그대로 둡니다. 구어체 어미·군더더기("결국", "뭘로", "~했어?")는 빼고 핵심 명사구 위주의 한 줄로 씁니다. 질문에 없는 사실을 더하지 마세요.
- intent: lookup(특정 사실 하나를 찾음) · aggregate(개수·목록·합계) · status(진행 상황·현황) · other

JSON 객체 하나로만 답하세요: {"rewrite": "...", "intent": "lookup"}

질문: ${question}`
  const r = await complete(LITE, prompt, { temperature: 0, maxOutputTokens: 512 })
  const j = parseJsonLoose(r.text)
  const rewrite = typeof j?.rewrite === "string" && j.rewrite.trim() ? j.rewrite.trim() : question
  const intent = INTENTS.includes(j?.intent as Intent) ? (j!.intent as Intent) : "other"
  return { rewrite, intent, usage: r.usage, costUsd: costUsd(r.usage, LITE.price), ms: r.ms }
}

// ─── LLM 리랭크 (R3) ─────────────────────────────────────────────
//
// WeKnora 는 전용 리랭커 모델(bge-reranker 등, 질문-문서 쌍마다 0~1)을 부른다 (reranking/rerank.go).
// 여기선 flash-lite 한 번에 후보 전부를 0~10 으로 매기게 한다 — 후보끼리 서로 보이는 listwise 채점이라 성질이 다르다.

/** 후보 본문을 이 글자 수로 자른다 */
const PASSAGE_CHARS = 400

export async function llmRerank(query: string, cands: { title: string; content: string }[]): Promise<LlmCall & { scores: number[]; parsed: boolean }> {
  const list = cands.map((c, i) => `[${i}] ${c.title}\n${c.content.slice(0, PASSAGE_CHARS)}`).join("\n\n")
  const prompt = `질문과 각 후보 문서의 관련도를 0~10 정수로 매기세요. 10 = 질문에 직접 답하는 내용, 5 = 같은 주제지만 답은 없음, 0 = 무관.

JSON 객체 하나로만 답하세요. 키는 후보 번호, 값은 점수: {"scores": {"0": 7, "1": 0, …}} — 후보 ${cands.length}개(0~${cands.length - 1}) 전부.

질문: ${query}

후보:
${list}`
  const r = await complete(LITE, prompt, { temperature: 0, maxOutputTokens: 1024 })
  // 번호를 키로 받는다. 순서 배열로 받았더니 30개 중 29개만 돌아와 뒤 점수가 한 칸씩 밀렸다 (2026-10-06 실측).
  // 빠진 번호는 0 점 — 리랭크가 실패해도 검색은 계속된다 (합성 점수에 RRF 30% 가 남는다)
  const raw = parseJsonLoose(r.text)?.scores
  const map = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  let found = 0
  const scores = cands.map((_, i) => {
    const v = Number(map[String(i)])
    if (!Number.isFinite(v)) return 0
    found++
    return Math.min(Math.max(v, 0), 10)
  })
  return { scores, parsed: found === cands.length, usage: r.usage, costUsd: costUsd(r.usage, LITE.price), ms: r.ms }
}
