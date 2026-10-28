// 벤더 어댑터 — 같은 루프가 Anthropic · Gemini · OpenAI · 고정 스크립트(dry-run)를 한 모양으로 부른다.
//
// Anthropic 은 공식 SDK(@anthropic-ai/sdk)를 쓴다. 5.5 세대의 제약을 여기서만 맞춘다 —
//   thinking 을 끌 수 없다(보내지 않는다 = adaptive) · budget_tokens 400 · temperature/top_p/top_k 400 ·
//   forced tool_choice(any/tool) 400 → tool_choice 는 보내지 않는다(auto) · 깊이는 output_config.effort.
// 모델이 낸 content(thinking 블록 포함)는 고치지 않고 그대로 다음 요청에 되돌린다.
// 1차 벤치의 providers.chatAnthropic(fetch · temperature)은 건드리지 않는다.
//
// Gemini 는 운영 runGeminiToolLoop(lib/ai.ts)와 같은 요청 모양 — functionDeclarations, 모델 parts 를
// thoughtSignature 까지 그대로 되돌림. 재시도·속도 제한은 providers.ts 의 것을 쓴다.
//
// OpenAI 는 공식 SDK(openai)의 Responses API. 다른 벤더와 같은 조건이 되도록 매번 전체 입력을 보낸다
// (previous_response_id 를 쓰지 않는다 · store=false). 그래서 추론 항목을 다음 요청에 되돌리려면
// include=["reasoning.encrypted_content"] 가 필요하다 — SDK 타입 주석: "Responses API 를 stateless 로
// 쓸 때(store=false) 추론 항목을 여러 턴에 쓰게 해 준다". 모델이 낸 output 항목(reasoning · function_call ·
// message)은 고치지 않고 그대로 input 에 붙인다. tool_choice 는 auto, temperature 는 보내지 않는다.
import Anthropic from "@anthropic-ai/sdk"
import OpenAI from "openai"
import type { ModelSpec } from "../config"
import { fetchWithRetry, throttle, now } from "../providers"
import type { ToolSpec } from "./tools"
import { ZERO_AGENT_USAGE, type AgentUsage } from "./types"

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface TurnOutput {
  text: string
  calls: ToolCall[]
  usage: AgentUsage
  ms: number
  stop?: string
  /** 이 요청의 추정 입력 토큰 (보낸 본문 기준) */
  estInput: number
  estOutput: number
}

export interface ToolResultIn {
  id: string
  name: string
  text: string
  isError: boolean
}

export interface Driver {
  turn(): Promise<TurnOutput>
  pushToolResults(results: ToolResultIn[]): void
}

/**
 * 거친 토큰 추산 — 한글 1자 ≈ 1토큰, 그 밖(영문·숫자·JSON 기호) 3.2자 ≈ 1토큰.
 * 벤더 토크나이저를 부르지 않고(count_tokens 도 API 호출이다) 돌리기 전 비용을 가늠하는 용도.
 * 실제 실행 결과의 usage 와 나란히 남기므로, 첫 시험 실행 뒤 비율을 보고 고친다.
 */
export function estTokens(s: string): number {
  let hangul = 0
  for (const ch of s) { const c = ch.codePointAt(0)!; if (c >= 0xac00 && c <= 0xd7a3) hangul++ }
  return Math.ceil(hangul + (s.length - hangul) / 3.2)
}

// ─── Anthropic ────────────────────────────────────────────────

let anthropicClient: Anthropic | null = null

function anthropicDriver(m: ModelSpec, system: string, tools: ToolSpec[], userText: string): Driver {
  anthropicClient ??= new Anthropic({ maxRetries: 4 })
  const client = anthropicClient
  const toolDefs: Anthropic.Tool[] = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema as Anthropic.Tool.InputSchema }))
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userText }]

  return {
    async turn() {
      const body: Anthropic.MessageCreateParamsNonStreaming = {
        model: m.id,
        max_tokens: m.maxOutputTokens ?? 16_000,
        system,
        tools: toolDefs,
        messages,
        // 자동 캐시 — 마지막 블록까지 캐시해 다음 턴은 앞부분을 캐시 읽기(입력 단가 1/10)로 낸다.
        // 운영에서도 같은 설정을 쓸 것이므로 건당 원에 그대로 반영한다.
        cache_control: { type: "ephemeral" },
        ...(m.effort ? { output_config: { effort: m.effort } } : {}),
      }
      const estInput = estTokens(JSON.stringify({ system, tools: toolDefs, messages }))
      await throttle(m)
      const t0 = now()
      const r = await client.messages.create(body)
      const ms = now() - t0
      messages.push({ role: "assistant", content: r.content as Anthropic.ContentBlockParam[] })

      const text = r.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("")
      const calls = r.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
        .map((b) => ({ id: b.id, name: b.name, args: (b.input ?? {}) as Record<string, unknown> }))
      const u = r.usage
      const cached = u.cache_read_input_tokens ?? 0
      const cacheWrite = u.cache_creation_input_tokens ?? 0
      return {
        text, calls, ms, stop: r.stop_reason ?? undefined,
        // Anthropic 은 thinking 토큰을 output_tokens 에 합쳐 보고한다 — 출력 단가라 비용은 같다.
        usage: { input: u.input_tokens + cached + cacheWrite, output: u.output_tokens, thinking: 0, cached, cacheWrite },
        estInput,
        estOutput: estTokens(text + JSON.stringify(calls)),
      }
    },
    pushToolResults(results) {
      // 병렬 호출의 결과는 한 user 메시지에 모아 보낸다.
      messages.push({
        role: "user",
        content: results.map((r) => ({ type: "tool_result" as const, tool_use_id: r.id, content: r.text, ...(r.isError ? { is_error: true } : {}) })),
      })
    },
  }
}

// ─── Gemini ───────────────────────────────────────────────────

type GeminiPart = Record<string, unknown> & {
  text?: string
  thought?: boolean
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> }
}

function geminiDriver(m: ModelSpec, system: string, tools: ToolSpec[], userText: string): Driver {
  const apiKey = process.env.GEMINI_API_KEY!
  const decls = tools.map((t) => ({
    name: t.name,
    description: t.description,
    ...(Object.keys(t.schema.properties).length ? { parameters: t.schema } : {}),
  }))
  const generationConfig: Record<string, unknown> = { temperature: 0.2, maxOutputTokens: m.maxOutputTokens ?? 8192 }
  if (m.thinking?.budget !== undefined) generationConfig.thinkingConfig = { thinkingBudget: m.thinking.budget }
  else if (m.thinking?.level) generationConfig.thinkingConfig = { thinkingLevel: m.thinking.level.toUpperCase() }
  const contents: { role: "user" | "model"; parts: GeminiPart[] }[] = [{ role: "user", parts: [{ text: userText }] }]

  return {
    async turn() {
      const body = JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        tools: [{ functionDeclarations: decls }],
        toolConfig: { functionCallingConfig: { mode: "AUTO" } },
        generationConfig,
      })
      await throttle(m)
      const t0 = now()
      const res = await fetchWithRetry(
        `https://generativelanguage.googleapis.com/v1beta/models/${m.id}:generateContent?key=${apiKey}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body },
        m.key
      )
      const ms = now() - t0
      const data = (await res.json()) as {
        candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[]
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number }
      }
      const cand = data.candidates?.[0]
      const parts = cand?.content?.parts ?? []
      contents.push({ role: "model", parts })
      const text = parts.filter((p) => !p.thought && !p.functionCall).map((p) => p.text ?? "").join("")
      const calls = parts
        .filter((p) => p.functionCall)
        .map((p, i) => ({ id: p.functionCall!.id ?? `call-${contents.length}-${i}`, name: p.functionCall!.name, args: p.functionCall!.args ?? {} }))
      const u = data.usageMetadata ?? {}
      return {
        text, calls, ms, stop: cand?.finishReason,
        usage: { input: u.promptTokenCount ?? 0, output: u.candidatesTokenCount ?? 0, thinking: u.thoughtsTokenCount ?? 0, cached: u.cachedContentTokenCount ?? 0, cacheWrite: 0 },
        estInput: estTokens(body),
        estOutput: estTokens(text + JSON.stringify(calls)),
      }
    },
    pushToolResults(results) {
      contents.push({
        role: "user",
        parts: results.map((r) => ({
          functionResponse: {
            ...(r.id.startsWith("call-") ? {} : { id: r.id }),
            name: r.name,
            response: r.isError ? { error: r.text } : { result: r.text },
          },
        })),
      })
    },
  }
}

// ─── OpenAI (Responses API) ───────────────────────────────────

export type OpenAiCreate = (body: OpenAI.Responses.ResponseCreateParamsNonStreaming) => Promise<OpenAI.Responses.Response>

let openaiClient: OpenAI | null = null

/** create 를 주면 그것으로 보낸다 — dry-run 이 가짜 응답으로 이 어댑터의 변환 경로를 돌리는 데 쓴다 */
export function openaiDriver(m: ModelSpec, system: string, tools: ToolSpec[], userText: string, create?: OpenAiCreate): Driver {
  const send: OpenAiCreate = create ?? ((body) => {
    openaiClient ??= new OpenAI({ maxRetries: 4 })
    return openaiClient.responses.create(body)
  })
  const toolDefs: OpenAI.Responses.FunctionTool[] = tools.map((t) => ({
    type: "function", name: t.name, description: t.description, parameters: t.schema, strict: false,
  }))
  const input: OpenAI.Responses.ResponseInputItem[] = [{ role: "user", content: userText }]

  return {
    async turn() {
      const body: OpenAI.Responses.ResponseCreateParamsNonStreaming = {
        model: m.id,
        instructions: system,
        input,
        tools: toolDefs,
        tool_choice: "auto",
        store: false,
        include: ["reasoning.encrypted_content"],
        max_output_tokens: m.maxOutputTokens ?? 16_000,
        ...(m.effort ? { reasoning: { effort: m.effort } } : {}),
      }
      const estInput = estTokens(JSON.stringify({ instructions: system, tools: toolDefs, input }))
      await throttle(m)
      const t0 = now()
      const r = await send(body)
      const ms = now() - t0
      // 받은 항목 그대로 — reasoning(encrypted_content 포함) · function_call · message
      input.push(...(r.output as OpenAI.Responses.ResponseInputItem[]))

      const calls = r.output
        .filter((o): o is OpenAI.Responses.ResponseFunctionToolCall => o.type === "function_call")
        .map((o) => {
          let args: Record<string, unknown> = {}
          try { args = JSON.parse(o.arguments || "{}") } catch { args = { _unparsed: o.arguments } }
          return { id: o.call_id, name: o.name, args }
        })
      const refused = r.output.some((o) => o.type === "message" && o.content.some((c) => c.type === "refusal"))
      const text = r.output_text ?? ""
      const u = r.usage
      const reasoning = u?.output_tokens_details?.reasoning_tokens ?? 0
      return {
        text, calls, ms,
        stop: refused ? "refusal" : r.incomplete_details?.reason ?? (calls.length ? "tool_use" : r.status ?? undefined),
        // input_tokens 는 캐시분을 포함한다. 출력은 추론 토큰을 thinking 으로 떼어 두되 단가는 같다.
        usage: {
          input: u?.input_tokens ?? 0, cached: u?.input_tokens_details?.cached_tokens ?? 0,
          output: Math.max((u?.output_tokens ?? 0) - reasoning, 0), thinking: reasoning, cacheWrite: 0,
        },
        estInput,
        estOutput: estTokens(text + JSON.stringify(calls)),
      }
    },
    pushToolResults(results) {
      for (const r of results) input.push({ type: "function_call_output", call_id: r.id, output: r.text })
    },
  }
}

/**
 * dry-run 용 가짜 OpenAI — 스크립트 순서대로 Responses API 모양의 output(reasoning + function_call / message)을 낸다.
 * 요청이 약속대로인지도 검사한다: previous_response_id · temperature 없음, tool_choice auto, store=false,
 * 직전에 낸 reasoning·function_call 항목이 고쳐지지 않고 그대로 있고, 모든 호출에 function_call_output 이 붙었는지.
 */
export function fakeOpenAiCreate(steps: ScriptStep[]): OpenAiCreate {
  let i = 0
  let lastOutput: unknown[] = []
  return async (body) => {
    const problems: string[] = []
    const b = body as unknown as Record<string, unknown>
    if ("previous_response_id" in b) problems.push("previous_response_id 를 보냄")
    if ("temperature" in b) problems.push("temperature 를 보냄")
    if (body.tool_choice !== "auto") problems.push(`tool_choice=${JSON.stringify(body.tool_choice)}`)
    if (body.store !== false) problems.push("store!=false")
    const sent = JSON.stringify(body.input)
    for (const item of lastOutput) if (!sent.includes(JSON.stringify(item))) problems.push(`직전 출력 항목이 그대로 오지 않음: ${JSON.stringify(item).slice(0, 80)}`)
    const items = (Array.isArray(body.input) ? body.input : []) as { type?: string; call_id?: string }[]
    for (const fc of items.filter((x) => x.type === "function_call")) {
      if (!items.some((x) => x.type === "function_call_output" && x.call_id === fc.call_id)) problems.push(`function_call_output 없음: ${fc.call_id}`)
    }
    if (problems.length) throw new Error(`가짜 OpenAI 요청 검사 실패: ${problems.join(" · ")}`)

    const step = steps[Math.min(i, steps.length - 1)]
    const reasoning = { type: "reasoning", id: `rs_dry_${i}`, summary: [], encrypted_content: `enc-${i}` }
    const output = step.calls?.length
      ? [reasoning, ...step.calls.map((c, j) => ({ type: "function_call", id: `fc_dry_${i}_${j}`, call_id: `call_dry_${i}_${j}`, name: c.name, arguments: JSON.stringify(c.args), status: "completed" }))]
      : [reasoning, { type: "message", id: `msg_dry_${i}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: step.text ?? "", annotations: [] }] }]
    lastOutput = output
    i++
    const inTok = estTokens(JSON.stringify(body))
    return {
      id: `resp_dry_${i}`, object: "response", status: "completed", output, output_text: step.calls?.length ? "" : step.text ?? "",
      incomplete_details: null,
      usage: { input_tokens: inTok, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens: 600, output_tokens_details: { reasoning_tokens: 600 }, total_tokens: inTok + 600 },
    } as unknown as OpenAI.Responses.Response
  }
}

// ─── 고정 스크립트 (dry-run) ───────────────────────────────────

export interface ScriptStep {
  calls?: { name: string; args: Record<string, unknown> }[]
  text?: string
}

/**
 * 모델 대신 정해진 순서로 도구를 부르고 답한다. 돈이 들지 않는다.
 * 요청 본문은 Anthropic 모양으로 실제처럼 쌓아 추정 토큰을 잰다 — 도구 결과(실제 DB 조회)가 그대로 들어간다.
 */
export function scriptedDriver(steps: ScriptStep[], system: string, tools: ToolSpec[], userText: string): Driver {
  const toolDefs = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema }))
  const history: unknown[] = [{ role: "user", content: userText }]
  let i = 0
  return {
    async turn() {
      const step = steps[Math.min(i, steps.length - 1)]
      const estInput = estTokens(JSON.stringify({ system, tools: toolDefs, messages: history }))
      const calls = (step.calls ?? []).map((c, j) => ({ id: `dry-${i}-${j}`, name: c.name, args: c.args }))
      const text = step.text ?? ""
      history.push({ role: "assistant", content: [...(text ? [{ type: "text", text }] : []), ...calls.map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.args }))] })
      i++
      const estOutput = estTokens(text + JSON.stringify(calls))
      return { text, calls, ms: 0, stop: calls.length ? "tool_use" : "end_turn", usage: { ...ZERO_AGENT_USAGE }, estInput, estOutput }
    },
    pushToolResults(results) {
      history.push({ role: "user", content: results.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.text })) })
    },
  }
}

export function createDriver(m: ModelSpec, system: string, tools: ToolSpec[], userText: string): Driver {
  switch (m.provider) {
    case "anthropic":
      return anthropicDriver(m, system, tools, userText)
    case "gemini":
      if (m.id.startsWith("gemma")) throw new Error(`${m.key}: Gemma 는 함수 호출이 없어 에이전트 벤치에서 뺀다`)
      return geminiDriver(m, system, tools, userText)
    case "openai":
      return openaiDriver(m, system, tools, userText)
    case "openai-compat":
      throw new Error(`${m.key}: OpenAI 호환 에이전트 어댑터는 아직 없다`)
  }
}
