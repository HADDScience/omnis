// wk-agent — WeKnora 식 ReAct 루프를 Gemini 네이티브 함수 호출로 옮겼다.
//
// 매 반복 = 모델 호출(think) → 도구 호출(act, 한 턴의 호출은 병렬) → 관찰(observe: 결과를 예산 안에서 잘라 다음 턴에).
// 모델이 도구 없이 글로 답하면 끝난다 (WeKnora 도 final_answer 도구가 아니라 "도구 호출 없는 자연 종료"가 답이다).
// 한도(20, WeKnora DefaultAgentMaxIterations)에 닿으면 도구를 끈(mode NONE) 호출 한 번으로 답만 받는다 (finalize.go handleMaxIterations).
//
// WeKnora 와 다른 점:
//   - 온도 0.2 (WeKnora 기본 0.7). N0(askOmnisRoute)와 같게 맞춰 조건을 하나만 바꾼다.
//   - 결과 자르기: 결과마다 문자 6,000 에서 앞부분만 남긴다. WeKnora trimToolResultsToBudget 은 전체 도구 결과를
//     컨텍스트의 20%(8k~32k 토큰) 안에 두려고 최신부터 예산을 나눠 주고 넘치는 것은 머리·꼬리 미리보기로 바꾼다.
//   - 압축: WeKnora compaction 은 오래된 대화를 LLM 으로 구조화 요약(목표·진행·결정·다음 단계·핵심 값)하고 최근 2만 토큰을
//     그대로 둔다. 여기선 LLM 을 부르지 않고, 직전 호출의 입력 토큰이 6만을 넘으면 최근 2턴을 뺀 도구 결과를
//     "도구·인자·길이·첫 줄" 한 줄로 바꾼다. 원가를 늘리지 않고 구조(오래된 것부터 줄이고 최근은 원문 유지)만 가져왔다.
//   - thinking 도구는 없다 (모델 thinking low 가 대신한다). 빈 응답 재시도는 WeKnora 처럼 2번.
import type { Caller } from "@/lib/omnis-mcp"
import type { ModelSpec } from "../config"
import { fetchWithRetry, now, ZERO_USAGE, addUsage, type Usage } from "../providers"
import type { MethodResult } from "../methods"
import { AGENT_TOOLS, runAgentTool, type ToolContext } from "./tools"
import { agentSystemPrompt, FINAL_ANSWER_NUDGE } from "./prompt"
import { agentStats, type AgentStats } from "./stats"

export const MAX_ITER = Number(process.env.WK_AGENT_MAX_ITER ?? 20)
/** 도구 결과 하나의 문자 상한 */
const RESULT_CHARS = 6_000
/** 직전 호출 입력 토큰이 이보다 크면 압축 */
const CONTEXT_TOKENS = 60_000
/** 압축해도 원문을 남기는 최근 도구 결과 턴 수 */
const KEEP_RECENT_TURNS = 2
const MAX_EMPTY_RETRIES = 2
/**
 * 심판에게 줄 근거 — 결과마다 앞부분만. 1,200 자로 잘랐더니 crm_overview(약 3천 자) 뒤쪽의 샘플요청을 심판이 못 보고
 * 맞는 답을 환각으로 판정했다 (스모크 2026-10-06, v4-mh-01). 전체 상한은 methods.ts AGENT_EVIDENCE_MAX
 */
const EVIDENCE_PER_RESULT = 3_000

type Part = Record<string, unknown> & {
  text?: string
  thought?: boolean
  functionCall?: { name: string; args?: Record<string, unknown> }
  functionResponse?: { name: string; response: { result: string } }
}
type Content = { role: "user" | "model"; parts: Part[] }

export interface AgentRun {
  answer: string
  usage: Usage
  llmMs: number
  toolMs: number
  trace: NonNullable<MethodResult["trace"]>
  stats: AgentStats
  ctx: ToolContext
  evidence: string
  finish?: string
  error?: string
}

/** 인자 요약 — 긴 문자열은 80자에서 자른다 (trace 기록용. 모델에는 원래 인자가 간다) */
function brief(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).map(([k, v]) => [k, typeof v === "string" && v.length > 80 ? `${v.slice(0, 80)}…` : v]))
}

async function callModel(model: ModelSpec, system: string, contents: Content[], mode: "AUTO" | "NONE") {
  const generationConfig: Record<string, unknown> = { temperature: 0.2, maxOutputTokens: 4096 }
  if (model.thinking?.budget !== undefined) generationConfig.thinkingConfig = { thinkingBudget: model.thinking.budget }
  else if (model.thinking?.level) generationConfig.thinkingConfig = { thinkingLevel: model.thinking.level.toUpperCase() }
  const t0 = now()
  const res = await fetchWithRetry(
    `https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        tools: [{ functionDeclarations: AGENT_TOOLS }],
        toolConfig: { functionCallingConfig: { mode } },
        generationConfig,
      }),
    },
    model.key
  )
  const ms = now() - t0
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: Part[] }; finishReason?: string }[]
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number }
  }
  const u = data.usageMetadata ?? {}
  const cand = data.candidates?.[0]
  return {
    parts: cand?.content?.parts ?? [],
    finish: cand?.finishReason,
    ms,
    usage: { input: u.promptTokenCount ?? 0, output: u.candidatesTokenCount ?? 0, thinking: u.thoughtsTokenCount ?? 0, cached: u.cachedContentTokenCount ?? 0 },
  }
}

/** 오래된 도구 결과를 한 줄로. 바꾼 것이 있으면 true */
function compact(contents: Content[]): boolean {
  const toolTurns = contents.map((c, i) => (c.parts.some((p) => p.functionResponse) ? i : -1)).filter((i) => i >= 0)
  let changed = false
  for (const i of toolTurns.slice(0, Math.max(0, toolTurns.length - KEEP_RECENT_TURNS))) {
    // 같은 턴의 functionCall(바로 앞 model 턴)과 짝을 맞춰 인자를 적는다
    const calls = contents[i - 1]?.parts.filter((p) => p.functionCall) ?? []
    contents[i].parts.forEach((p, j) => {
      const fr = p.functionResponse
      if (!fr || fr.response.result.startsWith("[압축됨]")) return
      const args = JSON.stringify(brief(calls[j]?.functionCall?.args ?? {}))
      const first = fr.response.result.split("\n").find((l) => l.trim())?.slice(0, 120) ?? ""
      fr.response.result = `[압축됨] ${fr.name}(${args}) 결과 ${fr.response.result.length}자. 첫 줄: ${first} — 자세히 필요하면 다시 부르세요.`
      changed = true
    })
  }
  return changed
}

export async function runWkAgent(model: ModelSpec, question: string, caller: Caller): Promise<AgentRun> {
  if (model.provider !== "gemini" || model.id.startsWith("gemma")) throw new Error(`wk-agent 는 Gemini 함수 호출 모델만 (${model.key})`)
  const system = agentSystemPrompt(new Date().toISOString().slice(0, 10), caller.name, MAX_ITER)
  const ctx: ToolContext = { caller, cite: new Map(), seen: new Set(), extraCostUsd: 0 }
  const contents: Content[] = [{ role: "user", parts: [{ text: question }] }]
  const trace: AgentRun["trace"] = []
  const evidence: string[] = []
  let usage = ZERO_USAGE
  let llmMs = 0
  let toolMs = 0
  let calls = 0
  let compactions = 0
  let lastPrompt = 0
  let finish: string | undefined

  const done = (answer: string, hitLimit: boolean, error?: string): AgentRun => ({
    answer, usage, llmMs: Math.round(llmMs), toolMs: Math.round(toolMs), trace,
    stats: agentStats(trace, calls, hitLimit, compactions), ctx, evidence: evidence.join("\n\n"), finish, error,
  })

  const call = async (mode: "AUTO" | "NONE") => {
    for (let attempt = 0; ; attempt++) {
      const r = await callModel(model, system, contents, mode)
      usage = addUsage(usage, r.usage)
      llmMs += r.ms
      calls++
      lastPrompt = r.usage.input
      finish = r.finish
      const text = r.parts.filter((p) => !p.thought).map((p) => p.text ?? "").join("").trim()
      const fcalls = r.parts.filter((p) => p.functionCall)
      if (fcalls.length || text || attempt >= MAX_EMPTY_RETRIES) return { parts: r.parts, text, fcalls }
    }
  }

  for (let iter = 1; iter <= MAX_ITER; iter++) {
    if (lastPrompt > CONTEXT_TOKENS && compact(contents)) compactions++
    const r = await call("AUTO")
    if (r.fcalls.length === 0) return done(r.text, false, r.text ? undefined : "빈 답변")

    // 모델 턴은 받은 그대로(thoughtSignature 포함) 되돌린다 — Gemini 3 는 서명이 없으면 거절한다
    contents.push({ role: "model", parts: r.parts })
    const results = await Promise.all(
      r.fcalls.map(async (p) => {
        const name = p.functionCall!.name
        const args = p.functionCall!.args ?? {}
        const t0 = now()
        let text: string
        try {
          text = await runAgentTool(name, args, ctx)
        } catch (err) {
          text = `오류: ${String(err).slice(0, 300)}`
        }
        const ms = Math.round(now() - t0)
        return { name, args, text, ms }
      })
    )
    for (const x of results) {
      trace.push({ step: iter, tool: x.name, args: brief(x.args), resultChars: x.text.length, ms: x.ms })
      if (x.name !== "todo_write") evidence.push(`[도구 ${x.name} ${JSON.stringify(brief(x.args))}]\n${x.text.slice(0, EVIDENCE_PER_RESULT)}`)
    }
    // 병렬 호출이라 도구 시간은 합계 대신 가장 긴 것을 더한다 (벽시계 기준)
    toolMs += Math.max(...results.map((x) => x.ms))
    contents.push({
      role: "user",
      parts: results.map((x) => ({
        functionResponse: {
          name: x.name,
          response: { result: x.text.length > RESULT_CHARS ? `${x.text.slice(0, RESULT_CHARS)}\n…(${x.text.length.toLocaleString()}자 중 ${RESULT_CHARS.toLocaleString()}자. 더 필요하면 조건을 좁혀 다시 부르세요)` : x.text },
        },
      })),
    })
  }

  // 한도 도달 — 도구를 끄고 답만 받는다
  if (lastPrompt > CONTEXT_TOKENS && compact(contents)) compactions++
  contents[contents.length - 1].parts.push({ text: FINAL_ANSWER_NUDGE })
  const last = await call("NONE")
  return done(last.text, true, last.text ? undefined : `${MAX_ITER}회 한도 뒤 답을 내지 못함`)
}
