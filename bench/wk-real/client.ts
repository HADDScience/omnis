// 실물 WeKnora(로컬 Docker v0.8.2) API 공통 — 설정·적재·bench 어댑터가 함께 쓴다.
//
// 상태 파일: $WK_LAB_DIR/state.json (setup.ts 가 쓴다. 계정·API 키·모델·KB id). git 밖 스크래치 폴더다.
// 말뭉치:   $WK_CORPUS_DIR/manifest.json (export.ts 가 쓰고 ingest.ts 가 knowledgeId 를 채운다).
// 절차: bench/wk-real/README.md
import { existsSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"

export const WK_BASE = process.env.WEKNORA_BASE_URL ?? "http://localhost:8581"

export function labDir(): string {
  const d = process.env.WK_LAB_DIR
  if (!d) throw new Error("WK_LAB_DIR 가 없습니다 — bench/wk-real/README.md 의 .env 항목을 보세요")
  return d
}

export function corpusDir(): string {
  const d = process.env.WK_CORPUS_DIR
  if (!d) throw new Error("WK_CORPUS_DIR 가 없습니다 — bench/wk-real/README.md 의 .env 항목을 보세요")
  return d
}

export interface WkState {
  email: string
  password: string
  tenantId: number
  chatModelId?: string
  embeddingModelId?: string
  kbId?: string
  apiKey?: string
  /** 설정 때 기록한 값 — 보고서용 */
  settings?: Record<string, unknown>
}

const statePath = () => join(labDir(), "state.json")

export function readState(): WkState {
  const p = statePath()
  if (!existsSync(p)) throw new Error(`${p} 가 없습니다 — npx tsx bench/wk-real/setup.ts 를 먼저 돌리세요`)
  return JSON.parse(readFileSync(p, "utf8")) as WkState
}

export function writeState(s: WkState) {
  writeFileSync(statePath(), JSON.stringify(s, null, 2), { mode: 0o600 })
}

export type Auth = { token: string } | { apiKey: string }

/**
 * Accept-Language 를 늘 ko-KR 로 보낸다. WeKnora 는 요약·질의 재작성·답변 프롬프트의 {{language}} 를
 * WEKNORA_LANGUAGE → Accept-Language → 기본값 순으로 정하는데, 헤더가 없으면 요약이 중국어로 나왔다(시험 문서 실측).
 * 한국어 말뭉치에 중국어 요약 청크가 색인되면 검색이 흐려진다. 서버 설정(.env)은 건드리지 않고 요청 헤더로만 정한다.
 */
function headers(auth: Auth, extra: Record<string, string> = {}): Record<string, string> {
  return { "Accept-Language": "ko-KR", ...("token" in auth ? { Authorization: `Bearer ${auth.token}` } : { "X-API-Key": auth.apiKey }), ...extra }
}

export async function wkJson<T = unknown>(method: string, path: string, auth: Auth | null, body?: unknown): Promise<T> {
  const res = await fetch(`${WK_BASE}/api/v1${path}`, {
    method,
    headers: { ...(auth ? headers(auth) : { "Accept-Language": "ko-KR" }), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`WeKnora ${method} ${path} → ${res.status} ${text.slice(0, 400)}`)
  return (text ? JSON.parse(text) : {}) as T
}

export async function wkForm<T = unknown>(path: string, auth: Auth, form: FormData): Promise<{ status: number; json: T }> {
  const res = await fetch(`${WK_BASE}/api/v1${path}`, { method: "POST", headers: headers(auth), body: form })
  const text = await res.text()
  let json: T
  try { json = JSON.parse(text) as T } catch { throw new Error(`WeKnora POST ${path} → ${res.status} ${text.slice(0, 300)}`) }
  return { status: res.status, json }
}

export async function login(s: Pick<WkState, "email" | "password">): Promise<{ token: string; tenantId: number }> {
  const r = await wkJson<{ token: string; active_tenant?: { id: number }; user?: { tenant_id: number } }>("POST", "/auth/login", null, { email: s.email, password: s.password })
  return { token: r.token, tenantId: r.active_tenant?.id ?? r.user?.tenant_id ?? 0 }
}

/** bench 어댑터용 — API 키 인증 */
export function apiAuth(): Auth {
  const s = readState()
  if (!s.apiKey) throw new Error("state.json 에 apiKey 가 없습니다 — setup.ts 를 다시 돌리세요")
  return { apiKey: s.apiKey }
}

// ─── SSE ───────────────────────────────────────────────────────

export interface WkSearchResult {
  id: string
  content: string
  knowledge_id: string
  knowledge_title?: string
  knowledge_filename?: string
  chunk_index?: number
  chunk_type?: string
  score?: number
  match_type?: unknown
  metadata?: Record<string, string>
}

export interface WkUsage { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cache_read_tokens?: number; cached_tokens?: number; reasoning_tokens?: number }

export interface WkStreamEvent {
  id?: string
  response_type: string
  content?: string
  done?: boolean
  knowledge_references?: WkSearchResult[]
  tool_calls?: { id?: string; type?: string; function?: { name: string; arguments: string } }[]
  data?: Record<string, unknown>
  session_id?: string
  assistant_message_id?: string
  usage?: WkUsage
  finish_reason?: string
}

/** POST 후 SSE 를 끝(complete · error)까지 읽어 이벤트 배열로 돌려준다 */
export async function wkStream(path: string, auth: Auth, body: unknown, onEvent?: (e: WkStreamEvent) => void, timeoutMs = 600_000): Promise<WkStreamEvent[]> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${WK_BASE}/api/v1${path}`, {
      method: "POST",
      headers: headers(auth, { "Content-Type": "application/json", Accept: "text/event-stream" }),
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    if (!res.ok || !res.body) throw new Error(`WeKnora POST ${path} → ${res.status} ${(await res.text()).slice(0, 400)}`)
    const events: WkStreamEvent[] = []
    const decoder = new TextDecoder()
    const reader = res.body.getReader()
    let buf = ""
    let finished = false
    while (!finished) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let i: number
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, i)
        buf = buf.slice(i + 2)
        const data = frame.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n")
        if (!data) continue
        let e: WkStreamEvent
        try { e = JSON.parse(data) as WkStreamEvent } catch { continue }
        events.push(e)
        onEvent?.(e)
        if ((e.response_type === "complete" || e.response_type === "error") && e.done !== false) finished = true
      }
    }
    await reader.cancel().catch(() => undefined)
    return events
  } finally {
    clearTimeout(timer)
  }
}
