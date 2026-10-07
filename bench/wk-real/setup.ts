// 실물 WeKnora 초기 설정 — 계정 → 모델 등록 → 지식베이스 → API 키. 여러 번 돌려도 있는 것은 다시 만들지 않는다.
//
//   npx tsx bench/wk-real/setup.ts
//
// 계정은 미리 /auth/register 로 만든 것을 $WK_LAB_DIR/state.json(email·password)에서 읽는다. 없으면 만든다.
// Gemini 키는 워크트리 .env 의 GEMINI_API_KEY 를 WeKnora 모델 행에 넣는다 — WeKnora 가 SYSTEM_AES_KEY 로 암호화해 저장한다.
// 키 값은 출력하지 않는다.
//
// 설정 (계획서 2026-10-06-weknora-lab.md 단계 4 · README):
//   채팅  gemini-3.8-flash  (생각 수준은 요청마다 reasoning_effort=low 로 준다 — 모델 행에는 없다)
//   임베딩 gemini-embedding-001, 768 차원 — Omnis 와 같은 차원. 공급자를 "openai"(WeKnora 의 OpenAI 호환 어댑터)로,
//         base_url 을 Gemini 의 OpenAI 호환 경로(/v1beta/openai)로 둔다. 같은 Gemini 모델·같은 키이고 프로토콜만 다르다.
//         왜: v0.8.2 의 gemini 공급자는 base_url 이 무엇이든 네이티브 batchEmbedContents 를 부르고(googleembeddings 가
//         /openai 접미사를 떼어 낸다) 차원을 embedContentConfig.outputDimensionality 에 넣는데, Gemini API 가 이 위치를
//         무시해 3072 가 온다. 2026-10-06 실측 — Gemini 직접 호출: embedContentConfig → 3072, 요청 최상위
//         outputDimensionality → 768, OpenAI 호환 dimensions → 768. WeKnora 색인: gemini 공급자 → 3072 (네이티브·/openai 둘 다),
//         generic 공급자 → 400 (truncate_prompt_tokens 를 Gemini 가 거부), openai 공급자 → 768.
//   리랭크 bench/wk-real/rerank-server.ts (호스트 127.0.0.1:8583 → 컨테이너에서 host.docker.internal:8583) — gemini-3.5-flash-lite
//         listwise 리랭크(R3 와 같은 llmRerank)를 cohere 형식으로 감싼 것. WeKnora 의 Gemini 공급자에는 rerank 모델이 없고,
//         v0.8.2 스마트 추론은 rerank 모델을 반드시 요구한다. 다른 벤더는 붙이지 않는다 (작업지시자 결정 2026-10-07).
//         WK_RERANK=off 로 돌리면 리랭크를 등록·연결하지 않는다
//   KB    document · 하이브리드(벡터+키워드, 기본값) · 청킹 strategy=auto 512/80 · md 는 Go simple 파서 · 요약 생성 기본값(켬)
import "dotenv/config"
import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { randomBytes } from "crypto"
import { wkJson, login, labDir, writeState, type WkState, type Auth } from "./client"
import { rerankToken } from "./rerank-server"

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"
const GEMINI_OPENAI_BASE = `${GEMINI_BASE}/openai`
const CHAT_MODEL = "gemini-3.8-flash"
const EMBED_MODEL = "gemini-embedding-001"
const EMBED_DIM = 768
const KB_NAME = "omnis-wklab"
const API_KEY_NAME = "omnis-bench"
const RERANK_NAME = "gemini-3.5-flash-lite-listwise"
const RERANK_BASE = `http://host.docker.internal:${process.env.WK_RERANK_PORT ?? 8583}`

interface Model { id: string; name: string; type: string; is_default?: boolean; parameters?: Record<string, unknown> }
interface KB { id: string; name: string; embedding_model_id?: string; summary_model_id?: string; chunking_config?: unknown; indexing_strategy?: unknown }

async function main() {
  const gemini = process.env.GEMINI_API_KEY
  if (!gemini) throw new Error("GEMINI_API_KEY 가 없습니다 (워크트리 .env)")

  const p = join(labDir(), "state.json")
  let state: WkState
  if (existsSync(p)) {
    state = JSON.parse(readFileSync(p, "utf8")) as WkState
  } else if (existsSync(join(labDir(), "login.json"))) {
    const l = JSON.parse(readFileSync(join(labDir(), "login.json"), "utf8")) as { email: string; password: string }
    state = { email: l.email, password: l.password, tenantId: 0 }
  } else {
    const password = `Lab${randomBytes(10).toString("hex")}9`
    state = { email: "lab@omnis.local", password, tenantId: 0 }
    await wkJson("POST", "/auth/register", null, { username: "omnis-lab", email: state.email, password })
  }
  const { token, tenantId } = await login(state)
  state.tenantId = tenantId
  writeState(state)
  const auth: Auth = { token }
  console.log(`로그인 · tenant ${tenantId}`)

  // ── 모델 ──
  const models = (await wkJson<{ data: Model[] }>("GET", "/models", auth)).data ?? []
  let chat = models.find((m) => m.type === "KnowledgeQA" && m.name === CHAT_MODEL)
  if (!chat) {
    chat = (await wkJson<{ data: Model }>("POST", "/models", auth, {
      name: CHAT_MODEL, display_name: `${CHAT_MODEL} (omnis-lab)`, type: "KnowledgeQA", source: "remote",
      parameters: { provider: "gemini", base_url: GEMINI_BASE, api_key: gemini },
    })).data
    console.log(`채팅 모델 등록 ${chat.id}`)
  }
  let embed = models.find((m) => m.type === "Embedding" && m.name === EMBED_MODEL && m.parameters?.provider === "openai" && m.parameters?.base_url === GEMINI_OPENAI_BASE)
  if (!embed) {
    embed = (await wkJson<{ data: Model }>("POST", "/models", auth, {
      name: EMBED_MODEL, display_name: `${EMBED_MODEL} ${EMBED_DIM}d (omnis-lab)`, type: "Embedding", source: "remote",
      parameters: { provider: "openai", base_url: GEMINI_OPENAI_BASE, api_key: gemini, embedding_parameters: { dimension: EMBED_DIM, supports_dimension_override: true } },
    })).data
    console.log(`임베딩 모델 등록 ${embed.id}`)
  }
  state.chatModelId = chat.id
  state.embeddingModelId = embed.id

  // 리랭크 — 호스트의 rerank-server.ts. 토큰은 $WK_LAB_DIR/rerank-token (WeKnora 가 Bearer 로 보낸다)
  let rerankId: string | undefined
  if (process.env.WK_RERANK !== "off") {
    let rr = models.find((m) => m.type === "Rerank" && m.name === RERANK_NAME)
    if (!rr) {
      rr = (await wkJson<{ data: Model }>("POST", "/models", auth, {
        name: RERANK_NAME, display_name: "Gemini flash-lite listwise rerank (bench/wk-real/rerank-server.ts)", type: "Rerank", source: "remote",
        parameters: { provider: "generic", base_url: RERANK_BASE, api_key: rerankToken(), extra_config: { score_scale: "probability" } },
      })).data
      console.log(`리랭크 모델 등록 ${rr.id}`)
    }
    rerankId = rr.id
    state.rerankModelId = rr.id
    // knowledge-search 는 테넌트 검색 설정의 rerank_model_id 를 쓴다 (없으면 첫 rerank 모델). 명시해 둔다
    const rc = (await wkJson<{ data: Record<string, unknown> }>("GET", "/tenants/kv/retrieval-config", auth)).data ?? {}
    if (rc.rerank_model_id !== rr.id) {
      await wkJson("PUT", "/tenants/kv/retrieval-config", auth, { ...rc, rerank_model_id: rr.id })
      console.log("테넌트 검색 설정 rerank_model_id 설정")
    }
  }

  // 연결 확인 — 임베딩 한 번 불러 본다 (원가 무시할 수준)
  const dbg = await debugModel(auth, embed.id, "연결 확인")
  console.log(`임베딩 debug ok=${dbg.ok} 차원=${dbg.dim ?? "?"}${dbg.error ? ` 오류=${dbg.error}` : ""}`)
  // debug 경로의 차원은 색인 경로와 다를 수 있다(gemini 공급자에서 둘 다 3072 였다). 실제 색인 차원은 ingest.ts 가 DB 에서 확인한다
  if (dbg.dim && dbg.dim !== EMBED_DIM) console.log(`  (debug 응답 차원 ${dbg.dim} — 색인 차원은 ingest.ts 의 확인 단계에서 본다)`)

  // ── 지식베이스 ──
  const kbs = (await wkJson<{ data: KB[] }>("GET", "/knowledge-bases", auth)).data ?? []
  let kb = kbs.find((k) => k.name === KB_NAME && k.embedding_model_id === embed!.id)
  if (!kb) {
    kb = (await wkJson<{ data: KB }>("POST", "/knowledge-bases", auth, {
      name: KB_NAME,
      description: "Omnis 실험 말뭉치 (업무·채팅·지식재산권·주간보고). bench/wk-real/export.ts",
      type: "document",
      embedding_model_id: embed.id,
      summary_model_id: chat.id,
      chunking_config: { strategy: "auto", chunk_size: 512, chunk_overlap: 80, parser_engine_rules: [{ file_types: ["md"], engine: "simple" }] },
      indexing_strategy: { vector_enabled: true, keyword_enabled: true, wiki_enabled: false, graph_enabled: false },
    })).data
    console.log(`지식베이스 생성 ${kb.id}`)
  }
  state.kbId = kb.id
  const kbFull = (await wkJson<{ data: KB }>("GET", `/knowledge-bases/${kb.id}`, auth)).data
  state.settings = {
    chatModel: CHAT_MODEL, embeddingModel: EMBED_MODEL, embeddingDim: EMBED_DIM,
    rerank: rerankId ? `${RERANK_NAME} @ ${RERANK_BASE} (bench/wk-real/rerank-server.ts)` : "없음",
    retrievalConfig: (await wkJson<{ data: unknown }>("GET", "/tenants/kv/retrieval-config", auth)).data,
    kb: { chunking_config: kbFull.chunking_config, indexing_strategy: kbFull.indexing_strategy, summary_model_id: kbFull.summary_model_id },
  }

  // ── 내장 에이전트 ── 빠른 답변·스마트 추론은 model_id 가 비어 있으면 "chat model is not configured" 로 거절한다.
  // 바꾸는 것은 model_id · rerank_model_id · web_search_enabled=false 뿐이다. 나머지 설정(임계값·반복 한도·도구·프롬프트)은 내장값 그대로
  const agentSettings: Record<string, unknown> = {}
  for (const id of ["builtin-quick-answer", "builtin-smart-reasoning"]) {
    const a = (await wkJson<{ data: { name: string; config: Record<string, unknown> } }>("GET", `/agents/${id}`, auth)).data
    const want = { model_id: chat.id, web_search_enabled: false, ...(rerankId ? { rerank_model_id: rerankId } : {}) }
    if (Object.entries(want).some(([k, v]) => a.config[k] !== v)) {
      await wkJson("PUT", `/agents/${id}`, auth, { config: { ...a.config, ...want } })
      console.log(`에이전트 ${id}: ${Object.keys(want).join(" · ")} 설정`)
    }
    const c = (await wkJson<{ data: { config: Record<string, unknown> } }>("GET", `/agents/${id}`, auth)).data.config
    agentSettings[id] = Object.fromEntries(Object.entries(c).filter(([k]) => !/prompt/i.test(k)))
  }
  state.settings.agents = agentSettings

  // ── API 키 ── 평문(token)은 만들 때 한 번만 온다. api_key 필드는 암호화된 값이라 인증에 못 쓴다.
  // 상태에 키가 없으면 같은 이름의 옛 키를 지우고 새로 만든다
  if (!state.apiKey) {
    const keys = (await wkJson<{ data: { id: number | string; name: string }[] }>("GET", `/tenants/${tenantId}/api-keys`, auth)).data ?? []
    for (const k of keys.filter((k) => k.name === API_KEY_NAME)) await wkJson("DELETE", `/tenants/${tenantId}/api-keys/${k.id}`, auth)
    const r = await wkJson<{ data: { api_key?: string; token?: string } }>("POST", `/tenants/${tenantId}/api-keys`, auth, { name: API_KEY_NAME, full_access: true })
    state.apiKey = r.data.token
    if (!state.apiKey) throw new Error("API 키 응답에 평문이 없습니다")
    console.log("API 키 발급 (state.json 에 저장)")
  }
  writeState(state)
  console.log(`완료 · KB ${state.kbId} · 채팅 ${state.chatModelId} · 임베딩 ${state.embeddingModelId}`)
}

async function debugModel(auth: Auth, id: string, input: string): Promise<{ ok: boolean; dim?: number; error?: string }> {
  if (!("token" in auth)) throw new Error("debug 는 JWT 로만")
  const form = new FormData()
  form.set("input", input)
  const res = await fetch(`${process.env.WEKNORA_BASE_URL ?? "http://localhost:8581"}/api/v1/models/${id}/debug`, { method: "POST", headers: { Authorization: `Bearer ${auth.token}` }, body: form })
  const j = (await res.json()) as { data?: { ok?: boolean; error?: string; raw_response?: unknown; observations?: unknown } }
  const raw = JSON.stringify(j.data ?? {})
  // 응답 모양이 버전마다 달라 차원은 "dimension" 키나 가장 긴 숫자 배열 길이로 찾는다
  const m = raw.match(/"dimensions?"\s*:\s*(\d+)/)
  return { ok: !!j.data?.ok, dim: m ? Number(m[1]) : undefined, error: j.data?.error }
}

main().catch((err) => { console.error(err); process.exitCode = 1 })
