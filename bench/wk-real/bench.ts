// 실물 WeKnora 를 bench 의 방법(weknora-rag · weknora-agent)과 검색기(WK-real · WK-real-chunk)로 부른다.
//
//   weknora-rag    POST /knowledge-chat  — 내장 "빠른 답변"(builtin-quick-answer): 질의 재작성·확장 → 하이브리드 검색 → 단발 생성
//   weknora-agent  POST /agent-chat      — 내장 "스마트 추론"(builtin-smart-reasoning): ReAct, 도구 search_knowledge·read_document·list_documents…
//   두 모드 모두 이 KB 하나만, web_search_enabled=false, reasoning_effort = 모델 축의 thinking.level (gemini-3.8-flash@low → low).
//   WeKnora 프롬프트는 건드리지 않는다(실물 대조). 그래서 답 형식(인용 표기·머리말)이 Omnis 팔과 다를 수 있다 — 블라인드 A/B 에서 드러날 수 있다.
//
// 근거 대조: WeKnora 검색 결과의 knowledge_id → manifest(export.ts)의 문서 → Omnis (source, sourceId).
//   문서 단위(doc)  문서의 대표 소스 + 포함한 CHAT_MESSAGE 전부를 그 순위에 펼친다 (업무 스레드 · 채팅 묶음 문서)
//   청크 단위(chunk) 청크 본문에 메시지 줄 앞머리(manifest probe)가 보이는 메시지만 + 대표 소스.
//                   요약 청크(chunk_type=summary)는 문서 전체를 요약하므로 문서 단위와 같게 펼친다.
import { readFileSync } from "fs"
import { join } from "path"
import type { ModelSpec } from "../config"
import type { MethodResult, OnStep } from "../methods"
import { agentStats } from "../agent/stats"
import { now, type Usage } from "../providers"
import { apiAuth, corpusDir, readState, wkJson, wkStream, type WkSearchResult, type WkStreamEvent, type WkUsage } from "./client"
import type { Manifest, ManifestDoc } from "./export"
import { execFileSync } from "child_process"

export interface SourceRef { source: string; sourceId: string }

let docsByKid: Map<string, ManifestDoc> | null = null

function docs(): Map<string, ManifestDoc> {
  if (docsByKid) return docsByKid
  const m = JSON.parse(readFileSync(join(corpusDir(), "manifest.json"), "utf8")) as Manifest
  docsByKid = new Map(m.docs.filter((d) => d.knowledgeId).map((d) => [d.knowledgeId!, d]))
  if (docsByKid.size === 0) throw new Error("manifest 에 knowledgeId 가 없습니다 — ingest.ts 를 먼저 돌리세요")
  return docsByKid
}

export function docOf(r: Pick<WkSearchResult, "knowledge_id">): ManifestDoc | undefined {
  return docs().get(r.knowledge_id)
}

function rep(d: ManifestDoc): SourceRef[] {
  return d.source && d.sourceId ? [{ source: d.source, sourceId: d.sourceId }] : []
}

/** 문서 단위 — 대표 소스 + 포함 메시지 전부 */
export function docSources(d: ManifestDoc): SourceRef[] {
  return [...rep(d), ...d.messages.map((m) => ({ source: "CHAT_MESSAGE", sourceId: m.id }))]
}

const squash = (s: string) => s.replace(/\s+/g, " ")

/** 청크 단위 — 청크 본문에 줄 앞머리가 보이는 메시지만 (+ 대표 소스). 하나도 안 보이면 대표 소스, 대표도 없으면 문서 단위 */
export function chunkSources(d: ManifestDoc, r: Pick<WkSearchResult, "content" | "chunk_type">): SourceRef[] {
  if (r.chunk_type === "summary") return docSources(d)
  const text = squash(r.content ?? "")
  const hit = d.messages.filter((m) => text.includes(squash(m.probe))).map((m) => ({ source: "CHAT_MESSAGE", sourceId: m.id }))
  if (hit.length === 0 && !d.source) return docSources(d)
  return [...rep(d), ...hit]
}

export function resultSources(r: WkSearchResult, mode: "doc" | "chunk"): SourceRef[] {
  const d = docOf(r)
  if (!d) return []
  return mode === "doc" ? docSources(d) : chunkSources(d, r)
}

// ─── 검색기 (retrieval-eval.ts) ────────────────────────────────

/**
 * POST /knowledge-search — WeKnora 의 검색 전용 API. 생성 없음.
 * 요청은 query · knowledge_base_ids · match_count 만. 나머지(벡터 0.15 · 키워드 0.3 임계값, rerank)는 테넌트 검색 설정 기본값이다.
 * rerank 모델이 없어 융합(RRF) 순서 그대로 온다. v0.8.2 응답에는 meta.rerank 가 없다(2026-10-06 실측).
 */
export async function wkSearch(query: string, matchCount: number): Promise<{ results: WkSearchResult[]; rerank?: unknown }> {
  const s = readState()
  const r = await wkJson<{ data: WkSearchResult[]; meta?: { rerank?: unknown } }>("POST", "/knowledge-search", apiAuth(), { query, knowledge_base_ids: [s.kbId], match_count: matchCount })
  return { results: r.data ?? [], rerank: r.meta?.rerank }
}

// ─── 생성 (methods.ts) ─────────────────────────────────────────

export type WkMode = "rag" | "agent"

const EVIDENCE_PER_RESULT = 3_000
const EVIDENCE_MAX = 12_000

function evidenceOf(refs: WkSearchResult[]): string {
  const seen = new Set<string>()
  const parts: string[] = []
  for (const r of refs) {
    if (seen.has(r.id)) continue
    seen.add(r.id)
    const d = docOf(r)
    parts.push(`[${d ? (d.source ? `${d.source}:${d.sourceId}` : `CHAT_DAY ${d.title}`) : r.knowledge_id} · ${r.knowledge_title ?? ""}${r.chunk_type && r.chunk_type !== "text" ? ` · ${r.chunk_type}` : ""}]\n${(r.content ?? "").slice(0, EVIDENCE_PER_RESULT)}`)
  }
  return parts.join("\n\n").slice(0, EVIDENCE_MAX)
}

function toUsage(u: WkUsage): Usage {
  return { input: u.prompt_tokens ?? 0, output: u.completion_tokens ?? 0, thinking: 0, cached: u.cache_read_tokens ?? u.cached_tokens ?? 0 }
}

/**
 * WeKnora 앱 로그의 "[LLM Usage] … purpose=… prompt_tokens=… completion_tokens=… session_id=<id>" 줄을 세션별로 합친다.
 * 빠른 답변은 SSE·DB 어디에도 사용량을 남기지 않는다(v0.8.2 실측: messages.usage 가 NULL). 로그에는 질의 재작성(query_rewrite)과
 * 답변(knowledge_qa)이 따로 찍힌다 — 그래서 로그가 한 턴의 모든 LLM 호출을 담는 유일한 곳이다. 임베딩 호출은 로그에 없다.
 */
export function usageFromLogs(sessionId: string, sinceIso: string): { usage: WkUsage; calls: number; purposes: Record<string, number> } | null {
  let out = ""
  try {
    out = execFileSync("docker", ["logs", "--since", sinceIso, "WeKnora-app"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] })
  } catch (err) {
    // docker logs 는 stderr 로도 쓴다 — 실패가 아니면 stdout 만 본다
    out = String((err as { stdout?: string }).stdout ?? "")
  }
  const u: WkUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cache_read_tokens: 0 }
  const purposes: Record<string, number> = {}
  let calls = 0
  for (const line of out.split("\n")) {
    if (!line.includes("[LLM Usage]") || !line.includes(`session_id=${sessionId}`)) continue
    const num = (k: string) => Number(line.match(new RegExp(`${k}=(\\d+)`))?.[1] ?? 0)
    u.prompt_tokens! += num("prompt_tokens")
    u.completion_tokens! += num("completion_tokens")
    u.total_tokens! += num("total_tokens")
    u.cache_read_tokens! += num("cache_read_tokens")
    // 빈 purpose 로 찍히는 호출이 있다 (빠른 답변 v4-ag-01 실측 — 어떤 단계인지 로그로는 알 수 없다)
    const purpose = line.match(/purpose=([^,]*)/)?.[1] || "purpose없음"
    purposes[purpose] = (purposes[purpose] ?? 0) + 1
    calls++
  }
  return calls ? { usage: u, calls, purposes } : null
}

/** SSE 에 usage 가 없을 때 WeKnora DB 의 messages.usage 를 본다 (assistant 메시지 id) */
function usageFromDb(messageId: string | undefined, sessionId: string): WkUsage | null {
  try {
    const where = messageId ? `id='${messageId.replace(/'/g, "")}'` : `session_id='${sessionId.replace(/'/g, "")}' and role='assistant'`
    const out = execFileSync("docker", ["exec", "WeKnora-postgres", "psql", "-U", "postgres", "-d", "WeKnora", "-At", "-c", `select usage::text from messages where ${where} order by created_at desc limit 1`], { encoding: "utf8" }).trim()
    if (!out || out === "null") return null
    const u = JSON.parse(out) as WkUsage
    return u.total_tokens || u.prompt_tokens ? u : null
  } catch { return null }
}

export async function runWeknora(mode: WkMode, model: ModelSpec, question: string, onStep?: OnStep): Promise<MethodResult> {
  if (model.provider !== "gemini" || model.id !== "gemini-3.8-flash") throw new Error(`WeKnora 에 등록한 채팅 모델은 gemini-3.8-flash 뿐이다 (${model.key})`)
  const s = readState()
  const auth = apiAuth()
  const effort = model.thinking?.level ?? "auto"
  const t0 = now()
  const sinceIso = new Date(Date.now() - 60_000).toISOString() // 호스트·VM 시계 차이 여유. 줄은 세션 id 로 거른다
  const session = (await wkJson<{ data: { id: string } }>("POST", "/sessions", auth, { title: `bench ${mode} ${new Date().toISOString()}` })).data
  const body = {
    query: question,
    knowledge_base_ids: [s.kbId],
    agent_id: mode === "rag" ? "builtin-quick-answer" : "builtin-smart-reasoning",
    agent_enabled: mode === "agent",
    reasoning_effort: effort,
    web_search_enabled: false,
    disable_title: true,
    channel: "api",
  }

  let answer = ""
  let firstRefAt = 0
  let firstAnswerAt = 0
  const refs: WkSearchResult[] = []
  const trace: NonNullable<MethodResult["trace"]> = []
  const open = new Map<string, { step: number; at: number; idx: number }>()
  let assistantMessageId: string | undefined
  let usage: WkUsage | undefined
  let finish: string | undefined
  let error: string | undefined
  let totalSteps = 0

  const onEvent = (e: WkStreamEvent) => {
    if (e.assistant_message_id) assistantMessageId = e.assistant_message_id
    switch (e.response_type) {
      case "answer":
        if (!firstAnswerAt) firstAnswerAt = now()
        answer += e.content ?? ""
        if (e.data?.truncated) finish = "truncated"
        break
      case "references":
        if (!firstRefAt) firstRefAt = now()
        refs.push(...(e.knowledge_references ?? []))
        break
      case "tool_call": {
        for (const c of e.tool_calls ?? []) {
          const name = c.function?.name ?? "?"
          let args: Record<string, unknown> = {}
          try { args = JSON.parse(c.function?.arguments || "{}") as Record<string, unknown> } catch { args = { raw: c.function?.arguments } }
          const step = trace.length + 1
          trace.push({ step, tool: name, args, resultChars: 0, ms: 0 })
          open.set(c.id ?? `${name}#${step}`, { step, at: now(), idx: trace.length - 1 })
          onStep?.(name, args)
        }
        // tool_calls 가 비어 있고 data 에 도구 이름이 오는 버전도 있다
        if (!e.tool_calls?.length && e.data?.tool_name) {
          const name = String(e.data.tool_name)
          const args = (e.data.arguments as Record<string, unknown>) ?? {}
          const step = trace.length + 1
          trace.push({ step, tool: name, args, resultChars: 0, ms: 0 })
          open.set(String(e.data.tool_call_id ?? `${name}#${step}`), { step, at: now(), idx: trace.length - 1 })
          onStep?.(name, args)
        }
        break
      }
      case "tool_result": {
        const id = String(e.data?.tool_call_id ?? "")
        const o = open.get(id) ?? [...open.values()].pop()
        if (o) {
          trace[o.idx].resultChars = (e.content ?? "").length
          trace[o.idx].ms = Math.round(now() - o.at)
          open.delete(id)
        }
        break
      }
      case "complete":
        if (e.usage) usage = e.usage
        else if (e.data?.usage) usage = e.data.usage as WkUsage
        if (typeof e.data?.total_steps === "number") totalSteps = e.data.total_steps
        if (e.finish_reason) finish = e.finish_reason
        break
      case "error":
        error = e.content || JSON.stringify(e.data ?? {}).slice(0, 300)
        break
    }
  }

  await wkStream(mode === "rag" ? `/knowledge-chat/${session.id}` : `/agent-chat/${session.id}`, auth, body, onEvent)
  const total = now() - t0

  // 사용량: 앱 로그(세션의 모든 LLM 호출) → SSE complete.usage → WeKnora DB messages.usage → 글자 수/4 추정. 어느 쪽인지 note 에 적는다
  let usageSrc = "SSE complete.usage"
  let llmCalls = 0
  const logged = usageFromLogs(session.id, sinceIso)
  if (logged) {
    usage = logged.usage
    llmCalls = logged.calls
    usageSrc = `WeKnora 앱 로그 [LLM Usage] ${Object.entries(logged.purposes).map(([k, v]) => `${k}×${v}`).join(" ")} (질문 임베딩 제외)`
  } else if (!usage || !(usage.total_tokens || usage.prompt_tokens)) {
    const db = usageFromDb(assistantMessageId, session.id)
    if (db) { usage = db; usageSrc = "WeKnora DB messages.usage" } else usage = undefined
  }
  const evidence = evidenceOf(refs)
  // 답도 참조도 없이 끝난 오류(요청 거절 등)는 모델이 불리지 않았다고 보고 0 으로 둔다
  const nothing = !answer && refs.length === 0
  const u: Usage = usage ? toUsage(usage) : nothing ? { input: 0, output: 0, thinking: 0, cached: 0 } : { input: Math.ceil((question.length + evidence.length) / 4), output: Math.ceil(answer.length / 4), thinking: 0, cached: 0 }
  if (!usage) usageSrc = nothing ? "없음(답·참조 없이 끝남)" : "추정(질문+참조 본문, 답 글자 수/4)"

  // 같은 청크가 여러 번 오면(에이전트가 같은 문서를 다시 검색) 첫 순서만
  const uniq = [...new Map(refs.map((r) => [r.id, r])).values()]
  const seenKeys = [...new Set(uniq.flatMap((r) => resultSources(r, "chunk")).map((x) => `${x.source}:${x.sourceId}`))]
  const retrievalMs = firstRefAt ? firstRefAt - t0 : 0
  return {
    answer,
    usage: u,
    timings: { retrieval: retrievalMs, context: 0, llm: total - retrievalMs, total },
    calls: llmCalls || (mode === "agent" ? Math.max(totalSteps, trace.length + 1) : 1),
    promptChars: 0,
    refs: uniq.map((r) => {
      const d = docOf(r)
      return { source: d?.source ?? (d ? "CHAT_DAY" : "?"), title: `${r.knowledge_title ?? ""}${r.chunk_type && r.chunk_type !== "text" ? ` [${r.chunk_type}]` : ""}`, similarity: Math.round((r.score ?? 0) * 100) }
    }),
    trace: mode === "agent" ? trace : [{ step: 0, tool: "weknora-quick-answer", args: { refs: uniq.length, firstAnswerMs: firstAnswerAt ? Math.round(firstAnswerAt - t0) : null }, resultChars: evidence.length, ms: Math.round(retrievalMs) }],
    finish,
    note: `usage: ${usageSrc}`,
    error,
    evidence,
    agent: mode === "agent" ? agentStats(trace, Math.max(totalSteps, trace.length + 1), false) : undefined,
    seen: seenKeys,
  }
}
