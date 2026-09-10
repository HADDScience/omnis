// 벤더 어댑터 — Gemini · Anthropic · OpenAI 호환을 같은 모양으로 부른다.
//
// 반환은 본문 + 사용량(입력·출력·thinking·캐시) + 걸린 시간. 비용은 여기서 계산하지 않는다
// (요금표는 config.ts, 계산은 cost()). SDK 를 안 쓰고 fetch 로 부른다 — 의존성을 늘리지 않으려는
// 프로덕션 코드(lib/ai.ts)와 같은 방식이다.
import { type ModelSpec, type Price } from "./config"

export interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

export interface Usage {
  input: number
  output: number
  thinking: number
  cached: number
}

export interface ChatResult {
  text: string
  usage: Usage
  ms: number
  /** 벤더가 보고한 종료 사유. 잘림(MAX_TOKENS 등)을 보기 위해 */
  finish?: string
}

export interface ChatOptions {
  temperature?: number
  maxOutputTokens?: number
}

/** 단조 시계 — Date.now 는 NTP 보정으로 뒤로 갈 수 있어 음수 시간이 나온다 (smoke 에서 실제로 났다) */
export const now = () => performance.now()

const ZERO: Usage = { input: 0, output: 0, thinking: 0, cached: 0 }

export function addUsage(a: Usage, b: Usage): Usage {
  return { input: a.input + b.input, output: a.output + b.output, thinking: a.thinking + b.thinking, cached: a.cached + b.cached }
}

/** USD. 캐시 토큰은 입력에서 빼고 캐시 단가로 센다. thinking 은 출력 단가 */
export function costUsd(u: Usage, p: Price): number {
  const cachedRate = p.cachedInput ?? p.input
  const fresh = Math.max(u.input - u.cached, 0)
  return (fresh * p.input + u.cached * cachedRate + (u.output + u.thinking) * p.output) / 1_000_000
}

// ─── 속도 제한 · 재시도 ─────────────────────────────────────────

const lastCallAt = new Map<string, number>()

async function throttle(m: ModelSpec) {
  if (!m.minIntervalMs) return
  const last = lastCallAt.get(m.key) ?? 0
  const wait = last + m.minIntervalMs - now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastCallAt.set(m.key, now())
}

async function fetchWithRetry(url: string, init: RequestInit, label: string, maxAttempts = 6): Promise<Response> {
  let lastErr = ""
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let res: Response
    try {
      res = await fetch(url, init)
    } catch (err) {
      lastErr = String(err)
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
      continue
    }
    if (res.ok) return res
    const body = await res.text()
    lastErr = `${res.status} ${body.slice(0, 300)}`
    // 과부하·속도 제한만 재시도. 나머지(400·401·404)는 설정 문제라 바로 던진다.
    if (res.status !== 429 && res.status !== 503 && res.status !== 500 && res.status !== 529) break
    const retryAfter = Number(res.headers.get("retry-after"))
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1500 * 2 ** attempt
    await new Promise((r) => setTimeout(r, Math.min(wait, 60_000)))
  }
  throw new Error(`[${label}] ${lastErr}`)
}

// ─── Gemini ───────────────────────────────────────────────────

async function chatGemini(m: ModelSpec, system: string | undefined, messages: ChatMessage[], opts: ChatOptions): Promise<ChatResult> {
  const apiKey = process.env.GEMINI_API_KEY!
  const isGemma = m.id.startsWith("gemma")
  const generationConfig: Record<string, unknown> = {
    temperature: opts.temperature ?? 0.3,
    maxOutputTokens: opts.maxOutputTokens ?? m.maxOutputTokens ?? 8192,
  }
  if (m.thinking?.budget !== undefined) generationConfig.thinkingConfig = { thinkingBudget: m.thinking.budget }
  else if (m.thinking?.level) generationConfig.thinkingConfig = { thinkingLevel: m.thinking.level.toUpperCase() }

  // Gemma 는 systemInstruction 을 받지 않는다 — 첫 사용자 턴 앞에 붙인다.
  const contents = messages.map((msg, i) => ({
    role: msg.role === "assistant" ? "model" : "user",
    parts: [{ text: isGemma && i === 0 && system ? `${system}\n\n${msg.content}` : msg.content }],
  }))
  const body: Record<string, unknown> = { contents, generationConfig }
  if (system && !isGemma) body.systemInstruction = { parts: [{ text: system }] }

  await throttle(m)
  const t0 = now()
  const res = await fetchWithRetry(
    `https://generativelanguage.googleapis.com/v1beta/models/${m.id}:generateContent?key=${apiKey}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    m.key,
    m.price.input === 0 ? 3 : 6   // 무료 티어는 한도가 분 단위로 풀리므로 길게 기다려도 소용없다
  )
  const ms = now() - t0
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[]
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number }
  }
  const cand = data.candidates?.[0]
  const text = (cand?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("")
  const u = data.usageMetadata ?? {}
  return {
    text,
    ms,
    finish: cand?.finishReason,
    usage: { input: u.promptTokenCount ?? 0, output: u.candidatesTokenCount ?? 0, thinking: u.thoughtsTokenCount ?? 0, cached: u.cachedContentTokenCount ?? 0 },
  }
}

// ─── Anthropic ────────────────────────────────────────────────

async function chatAnthropic(m: ModelSpec, system: string | undefined, messages: ChatMessage[], opts: ChatOptions): Promise<ChatResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY!
  const body: Record<string, unknown> = {
    model: m.id,
    max_tokens: opts.maxOutputTokens ?? m.maxOutputTokens ?? 8192,
    messages: messages.map((msg) => ({ role: msg.role, content: msg.content })),
  }
  if (system) body.system = system
  if (m.anthropicThinkingBudget) {
    body.thinking = { type: "enabled", budget_tokens: m.anthropicThinkingBudget }
  } else {
    body.temperature = opts.temperature ?? 0.3
  }

  await throttle(m)
  const t0 = now()
  const send = () =>
    fetchWithRetry(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(body),
      },
      m.key
    )
  let res: Response
  try {
    res = await send()
  } catch (err) {
    // Sonnet 5 부터 temperature 를 거절한다 ("`temperature` is deprecated for this model", 2026-09-09 실측).
    // 그 모델은 빼고 다시 보낸다 — 기본값(1.0)으로 돈다는 뜻이라 결과에 적어 둔다.
    if (!String(err).includes("temperature") || !("temperature" in body)) throw err
    delete body.temperature
    res = await send()
  }
  const ms = now() - t0
  const data = (await res.json()) as {
    content?: { type: string; text?: string }[]
    stop_reason?: string
    usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
  }
  const text = (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("")
  const u = data.usage ?? {}
  // Anthropic 은 thinking 토큰을 output_tokens 에 합쳐 보고한다 — 따로 못 나눈다.
  const cached = u.cache_read_input_tokens ?? 0
  return {
    text,
    ms,
    finish: data.stop_reason,
    usage: { input: (u.input_tokens ?? 0) + cached + (u.cache_creation_input_tokens ?? 0), output: u.output_tokens ?? 0, thinking: 0, cached },
  }
}

// ─── OpenAI 호환 (Groq · OpenRouter · OpenAI) ────────────────────

async function chatOpenAiCompat(m: ModelSpec, system: string | undefined, messages: ChatMessage[], opts: ChatOptions): Promise<ChatResult> {
  const base = process.env.OPENAI_COMPAT_BASE_URL!.replace(/\/$/, "")
  const apiKey = process.env.OPENAI_COMPAT_API_KEY!
  const body = {
    model: m.id,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxOutputTokens ?? m.maxOutputTokens ?? 8192,
    messages: [...(system ? [{ role: "system", content: system }] : []), ...messages],
  }

  await throttle(m)
  const t0 = now()
  const res = await fetchWithRetry(
    `${base}/chat/completions`,
    { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body) },
    m.key
  )
  const ms = now() - t0
  const data = (await res.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[]
    usage?: {
      prompt_tokens?: number
      completion_tokens?: number
      completion_tokens_details?: { reasoning_tokens?: number }
      prompt_tokens_details?: { cached_tokens?: number }
    }
  }
  const u = data.usage ?? {}
  const thinking = u.completion_tokens_details?.reasoning_tokens ?? 0
  return {
    text: data.choices?.[0]?.message?.content ?? "",
    ms,
    finish: data.choices?.[0]?.finish_reason,
    usage: { input: u.prompt_tokens ?? 0, output: Math.max((u.completion_tokens ?? 0) - thinking, 0), thinking, cached: u.prompt_tokens_details?.cached_tokens ?? 0 },
  }
}

// ─── 진입점 ─────────────────────────────────────────────────

export async function chat(m: ModelSpec, system: string | undefined, messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
  if (m.maxPromptChars) {
    const chars = (system?.length ?? 0) + messages.reduce((a, msg) => a + msg.content.length, 0)
    if (chars > m.maxPromptChars) throw new Error(`[${m.key}] 프롬프트 ${chars.toLocaleString()}자 > 한도 ${m.maxPromptChars.toLocaleString()}자 (무료 티어 분당 토큰 한도). 보내지 않음`)
  }
  switch (m.provider) {
    case "gemini":
      return chatGemini(m, system, messages, opts)
    case "anthropic":
      return chatAnthropic(m, system, messages, opts)
    case "openai-compat":
      return chatOpenAiCompat(m, system, messages, opts)
  }
}

/** 단일 프롬프트 편의 함수 — 프로덕션 callGemini 와 같은 모양(프롬프트 하나, 시스템 없음) */
export async function complete(m: ModelSpec, prompt: string, opts: ChatOptions = {}): Promise<ChatResult> {
  return chat(m, undefined, [{ role: "user", content: prompt }], opts)
}

export { ZERO as ZERO_USAGE }
