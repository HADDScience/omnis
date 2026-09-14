// 방법론 축 — 같은 질문을 다섯 가지 컨텍스트 전략으로 푼다.
//
//   baseline  지금 askOmnis 그대로: 벡터 top-8 + 업무·IP·CRM 전량 요약
//   vector    벡터 top-8 만
//   hybrid    벡터 + 키워드 RRF top-8 만
//   stuff     검색 없이 요약 + 카드 전문 + 최근 60일 채팅 통째
//   route     도구 호출 루프 (JSON 프로토콜, 최대 5단계)
//   native    프로덕션 askOmnisRoute 그대로 — Gemini 네이티브 함수 호출 + 하이브리드 검색 (Gemini 모델만)
//
// 결과에는 답변·사용량·단계별 시간·호출 수·(route 면) 도구 호출 자취가 남는다.
import { buildOmnisAnswerPrompt } from "@/lib/ai"
import { askOmnisRoute } from "@/lib/omnis-ask"
import type { Caller } from "@/lib/omnis-mcp"
import { type ModelSpec, type MethodName } from "./config"
import { chat, complete, addUsage, now, ZERO_USAGE, type Usage, type ChatMessage } from "./providers"
import { vectorSearch, hybridSearch, overviews, stuffCorpus, type RefChunk } from "./context"
import { routeSystemPrompt, parseRouteReply, runBenchTool } from "./tools"

export interface Timings {
  /** 임베딩 호출 + pgvector (검색 방법론만) */
  retrieval: number
  /** 현황 DB 조회·말뭉치 조립 */
  context: number
  /** 생성 호출 합계 */
  llm: number
  total: number
}

export interface MethodResult {
  answer: string
  usage: Usage
  timings: Timings
  /** 생성 호출 횟수 (route 는 2 이상) */
  calls: number
  /** 프롬프트에 들어간 문자 수 — 토큰 대신 벤더 무관하게 비교하는 크기 */
  promptChars: number
  refs: { source: string; title: string; similarity: number }[]
  trace?: { step: number; tool: string; args: Record<string, unknown>; resultChars: number; ms: number }[]
  finish?: string
  /** 실패는 아니지만 기록할 것 (route 가 JSON 을 안 지키고 산문으로 답한 경우 등) */
  note?: string
  error?: string
  /** 심판이 환각을 가려낼 때 볼 자료 — 모델이 실제로 본 청크·도구 결과 (앞 8천 자) */
  evidence: string
}

const EVIDENCE_MAX = 8_000

const today = () => new Date().toISOString().slice(0, 10)

async function answerFrom(model: ModelSpec, question: string, refs: RefChunk[], overview: string | undefined, t: { retrieval: number; context: number }, t0: number): Promise<MethodResult> {
  if (refs.length === 0 && !overview) {
    // 프로덕션은 이 경우 모델을 부르지 않는다 (answerWithOmnis 첫 줄).
    return {
      answer: "참고할 만한 사내 자료를 찾지 못했어요. 질문을 더 구체적으로 바꾸거나, 옴니스 카드에 관련 내용을 추가해 주세요.",
      usage: ZERO_USAGE, timings: { ...t, llm: 0, total: now() - t0 }, calls: 0, promptChars: 0, refs: [], evidence: "",
    }
  }
  const prompt = buildOmnisAnswerPrompt(question, refs, overview)
  const r = await complete(model, prompt, { temperature: 0.3 })
  return {
    answer: r.text,
    usage: r.usage,
    timings: { ...t, llm: r.ms, total: now() - t0 },
    calls: 1,
    promptChars: prompt.length,
    refs: refs.map((c) => ({ source: c.source, title: c.title, similarity: Math.round(c.similarity * 100) })),
    finish: r.finish,
    evidence: [...refs.map((c) => `[${c.sourceLabel} · ${c.title}]\n${c.content}`), overview ? `[현황]\n${overview}` : ""].filter(Boolean).join("\n\n").slice(0, EVIDENCE_MAX),
  }
}

async function baseline(model: ModelSpec, question: string): Promise<MethodResult> {
  const t0 = now()
  const [search, ov] = await Promise.all([vectorSearch(question, 8, 0.3), overviews()])
  return answerFrom(model, question, search.value, ov.value || undefined, { retrieval: search.ms, context: ov.ms }, t0)
}

async function vector(model: ModelSpec, question: string): Promise<MethodResult> {
  const t0 = now()
  const search = await vectorSearch(question, 8, 0.3)
  return answerFrom(model, question, search.value, undefined, { retrieval: search.ms, context: 0 }, t0)
}

async function hybrid(model: ModelSpec, question: string): Promise<MethodResult> {
  const t0 = now()
  const search = await hybridSearch(question, 8)
  const r = await answerFrom(model, question, search.value, undefined, { retrieval: search.ms, context: 0 }, t0)
  r.trace = [{ step: 0, tool: "keywords", args: { keywords: search.keywords }, resultChars: 0, ms: 0 }]
  return r
}

async function stuff(model: ModelSpec, question: string): Promise<MethodResult> {
  const t0 = now()
  const tc = now()
  const corpus = await stuffCorpus()
  const contextMs = now() - tc
  // 검색 청크 자리에 말뭉치 전체를 하나의 "참고 자료" 로 넣는다. 프롬프트 지시문은 프로덕션과 같다.
  const refs: RefChunk[] = [{ title: "사내 자료 전체", content: corpus.text, sourceLabel: "전체", source: "OMNIS_CARD", similarity: 1 }]
  const r = await answerFrom(model, question, refs, undefined, { retrieval: 0, context: contextMs }, t0)
  r.evidence = "(통째 말뭉치 — 심판에게 주기엔 큼. 생략)"
  r.refs = [{ source: "STUFF", title: `chars=${corpus.chars} (overview ${corpus.parts.overview} · cards ${corpus.parts.cards} · chat ${corpus.parts.chat}/${corpus.parts.messages}건)`, similarity: 100 }]
  return r
}

async function route(model: ModelSpec, question: string, caller: Caller): Promise<MethodResult> {
  const t0 = now()
  const system = routeSystemPrompt(today())
  const messages: ChatMessage[] = [{ role: "user", content: question }]
  let usage = ZERO_USAGE
  let llm = 0
  let calls = 0
  let toolMs = 0
  let promptChars = system.length + question.length
  const trace: NonNullable<MethodResult["trace"]> = []
  const refs: MethodResult["refs"] = []
  const evidence: string[] = []
  const done = (answer: string, extra: Partial<MethodResult> = {}): MethodResult => ({
    answer, usage, timings: { retrieval: 0, context: toolMs, llm, total: now() - t0 }, calls, promptChars, refs, trace,
    evidence: evidence.join("\n\n").slice(0, EVIDENCE_MAX), ...extra,
  })

  for (let step = 1; step <= 6; step++) {
    const r = await chat(model, system, messages, { temperature: 0.2, maxOutputTokens: 4096 })
    usage = addUsage(usage, r.usage)
    llm += r.ms
    calls++
    const parsed = parseRouteReply(r.text)
    if (!parsed) {
      // JSON 이 아니면 그 본문을 답으로 본다. 실패는 아니지만 프로토콜을 안 지킨 것은 note 로 남긴다.
      return done(r.text, { finish: r.finish, note: "protocol: 산문으로 답함" })
    }
    if (parsed.answer !== undefined || !parsed.call) {
      return done(String(parsed.answer ?? ""), { finish: r.finish })
    }
    if (step === 6) {
      return done("", { error: "route: 6단계 안에 답을 내지 못함" })
    }
    const args = parsed.call.args ?? {}
    const tt = now()
    const result = await runBenchTool(parsed.call.name, args, caller)
    const ms = now() - tt
    toolMs += ms
    const text = "error" in result ? `오류: ${result.error}` : result.text
    trace.push({ step, tool: parsed.call.name, args, resultChars: text.length, ms })
    evidence.push(`[도구 ${parsed.call.name} ${JSON.stringify(args)}]\n${text}`)
    if (parsed.call.name === "search_knowledge") refs.push({ source: "TOOL", title: `search_knowledge(${String(args.query ?? "")})`, similarity: 0 })
    messages.push({ role: "assistant", content: r.text })
    messages.push({
      role: "user",
      content: `[도구 결과: ${parsed.call.name}]\n${text.slice(0, 12_000)}\n\n(계속 JSON 객체 하나로만 응답하세요 — 도구를 더 부르려면 {"call": …}, 답하려면 {"answer": …})`,
    })
    promptChars += r.text.length + Math.min(text.length, 12_000)
  }
  throw new Error("unreachable")
}

async function native(model: ModelSpec, question: string, caller: Caller): Promise<MethodResult> {
  if (model.provider !== "gemini" || model.id.startsWith("gemma")) throw new Error(`native 는 Gemini 함수 호출 모델만 (${model.key})`)
  const t0 = now()
  const r = await askOmnisRoute(question, caller.userId, { model: model.id, thinking: model.thinking ?? (model.id.startsWith("gemini-2.5") ? { budget: 0 } : { level: "low" }), dryRun: true })
  const m = r.meta
  return {
    answer: r.answer,
    usage: { input: m.usage.promptTokens, output: m.usage.candidateTokens, thinking: m.usage.thinkingTokens, cached: m.usage.cachedTokens },
    timings: { retrieval: 0, context: m.ms.tools, llm: m.ms.llm, total: now() - t0 },
    calls: m.calls,
    promptChars: 0,
    refs: r.sources.map((s) => ({ source: s.source, title: s.title, similarity: s.similarity })),
    trace: m.trace,
    evidence: m.trace.map((t) => `[도구 ${t.tool} ${JSON.stringify(t.args)}] (${t.resultChars}자)`).join("\n"),
    error: r.answer.startsWith("답을 정리하지 못했습니다") ? r.answer : undefined,
  }
}

export async function runMethod(name: MethodName, model: ModelSpec, question: string, caller: Caller): Promise<MethodResult> {
  switch (name) {
    case "native": return native(model, question, caller)
    case "baseline": return baseline(model, question)
    case "vector": return vector(model, question)
    case "hybrid": return hybrid(model, question)
    case "stuff": return stuff(model, question)
    case "route": return route(model, question, caller)
  }
}
