// 말뭉치($WK_CORPUS_DIR) → 실물 WeKnora 지식베이스. 올리고, 파싱·임베딩·요약이 끝날 때까지 폴링한다.
//
//   npx tsx bench/wk-real/ingest.ts            # 이어서 돌리면 이미 올린 문서(manifest 의 knowledgeId)는 건너뛴다
//
// 문서마다 POST /knowledge-bases/:id/knowledge/file (파일명 = manifest 의 file). metadata 에는 대표 소스와 메시지 수만 넣는다 —
// WeKnora 는 이 값을 검색 결과의 metadata 로 돌려줄 뿐 모델 프롬프트에는 넣지 않는다(custom_metadata 와 다르다).
// 메시지 id 목록은 manifest.json 에 있다.
//
// 비용 → bench ledger 의 run "wk-real-ingest".
//   요약(LLM): WeKnora 앱 로그 "[LLM Usage] … purpose=document_summary" 줄의 실제 토큰 합 (업로드 시작 이후). API·DB 에는 없다.
//   임베딩: 로그·API·DB 어디에도 토큰이 없다(v0.8.2 실측) → 글자 수/4 추정. 임베딩 = (문서 + 요약 청크) 글자.
//   로그 줄을 못 찾으면 요약도 글자 수/4 로 추정한다: 입력 = min(문서, 8192) + 요약 프롬프트 글자, 출력 = 요약 글자.
//   (첫 적재에서 추정은 출력 3.7만 토큰이었는데 로그 실측은 41만이었다 — 생각 토큰·프로필 JSON 이 출력에 든다. 추정은 크게 낮다)
import "dotenv/config"
import { readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { execFileSync } from "child_process"
import { apiAuth, corpusDir, readState, wkForm, wkJson } from "./client"
import type { Manifest, ManifestDoc } from "./export"
import { MODELS, EMBEDDING_PRICE_USD_PER_M, usdToKrw } from "../config"
import { appendLedger } from "../ledger"
import { now } from "../providers"

/** 앱 로그의 purpose=document_summary 줄 합계 */
function summaryUsageFromLogs(sinceIso: string): { calls: number; prompt: number; completion: number } {
  let out = ""
  try { out = execFileSync("docker", ["logs", "--since", sinceIso, "WeKnora-app"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }) } catch (err) { out = String((err as { stdout?: string }).stdout ?? "") }
  const r = { calls: 0, prompt: 0, completion: 0 }
  for (const line of out.split("\n")) {
    if (!line.includes("[LLM Usage]") || !line.includes("purpose=document_summary")) continue
    r.calls++
    r.prompt += Number(line.match(/prompt_tokens=(\d+)/)?.[1] ?? 0)
    r.completion += Number(line.match(/completion_tokens=(\d+)/)?.[1] ?? 0)
  }
  return r
}

const CONCURRENCY = 4
const POLL_MS = 15_000
const TIMEOUT_MS = 90 * 60_000
/** v0.8.2 config.yaml conversation.summary.max_input_chars · prompt_templates/generate_summary.yaml 크기 (2026-10-06 이미지에서 확인) */
const SUMMARY_MAX_INPUT = 8192
const SUMMARY_PROMPT_CHARS = 2_987

interface Knowledge { id: string; file_name?: string; title?: string; parse_status: string; summary_status?: string; description?: string; error_message?: string }

function psql(sql: string): string {
  return execFileSync("docker", ["exec", "WeKnora-postgres", "psql", "-U", "postgres", "-d", "WeKnora", "-At", "-F", "|", "-c", sql], { encoding: "utf8" }).trim()
}

async function main() {
  const dir = corpusDir()
  const mPath = join(dir, "manifest.json")
  const manifest = JSON.parse(readFileSync(mPath, "utf8")) as Manifest
  const state = readState()
  if (!state.kbId) throw new Error("state.json 에 kbId 가 없습니다 — setup.ts 먼저")
  const auth = apiAuth()
  const save = () => writeFileSync(mPath, JSON.stringify(manifest, null, 2))

  const todo = manifest.docs.filter((d) => !d.knowledgeId)
  console.log(`KB ${state.kbId} · 문서 ${manifest.docs.length} (올릴 것 ${todo.length})`)
  const t0 = now()
  const sinceIso = new Date(Date.now() - 60_000).toISOString()
  let uploaded = 0
  const failedUpload: string[] = []
  const queue = [...todo]
  const worker = async () => {
    for (let d = queue.shift(); d; d = queue.shift()) {
      try { d.knowledgeId = await upload(state.kbId!, d, auth, dir) } catch (err) { failedUpload.push(`${d.file}: ${String(err).slice(0, 200)}`) }
      uploaded++
      if (uploaded % 50 === 0) { save(); console.log(`  올림 ${uploaded}/${todo.length} (${Math.round((now() - t0) / 1000)}s)`) }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  save()
  console.log(`업로드 끝 ${uploaded}건 · 실패 ${failedUpload.length} · ${Math.round((now() - t0) / 1000)}s`)
  for (const f of failedUpload.slice(0, 10)) console.log(`  ✗ ${f}`)

  // ── 폴링 ── 파싱·요약이 모두 끝날 때까지
  let last = ""
  let all: Knowledge[] = []
  for (;;) {
    all = await listKnowledge(state.kbId, auth)
    const by = (k: keyof Knowledge, v: string) => all.filter((x) => x[k] === v).length
    const busy = all.filter((x) => ["pending", "processing", "finalizing"].includes(x.parse_status) || ["pending", "processing"].includes(x.summary_status ?? ""))
    const line = `  ${Math.round((now() - t0) / 1000)}s · 문서 ${all.length} · 완료 ${by("parse_status", "completed")} · 실패 ${by("parse_status", "failed")} · 진행 ${busy.length} · 요약 완료 ${by("summary_status", "completed")}`
    if (line !== last) console.log(line)
    last = line
    if (busy.length === 0 && all.length >= manifest.docs.length - failedUpload.length) break
    if (now() - t0 > TIMEOUT_MS) { console.log("⚠ 시간 한도 — 진행 중인 문서를 남기고 멈춤"); break }
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
  const elapsedS = Math.round((now() - t0) / 1000)

  // ── 수치 ──
  const kb = state.kbId
  const chunkRows = psql(`select chunk_type, count(*), coalesce(sum(length(content)),0) from chunks where knowledge_base_id='${kb}' and deleted_at is null group by 1 order by 1`)
  const dimRows = psql(`select dimension, count(*) from embeddings where knowledge_base_id='${kb}' group by 1`)
  const failed = all.filter((k) => k.parse_status === "failed")
  const summaryFailed = all.filter((k) => k.summary_status === "failed")
  const docChars = manifest.docs.filter((d) => d.knowledgeId).reduce((a, d) => a + d.chars, 0)
  const summaryChars = all.reduce((a, k) => a + (k.description?.length ?? 0), 0)
  const summaryChunkChars = Number(psql(`select coalesce(sum(length(content)),0) from chunks where knowledge_base_id='${kb}' and deleted_at is null and chunk_type='summary'`) || 0)
  const summarized = all.filter((k) => k.summary_status === "completed").length
  const sumIn = manifest.docs.filter((d) => d.knowledgeId).reduce((a, d) => a + Math.min(d.chars, SUMMARY_MAX_INPUT) + SUMMARY_PROMPT_CHARS, 0)
  const logged = summaryUsageFromLogs(sinceIso)
  const fromLogs = logged.calls > 0
  const tok = { embed: Math.ceil((docChars + summaryChunkChars) / 4), sumIn: fromLogs ? logged.prompt : Math.ceil(sumIn / 4), sumOut: fromLogs ? logged.completion : Math.ceil(summaryChars / 4) }
  const flash = MODELS.find((m) => m.key === "gemini-3.8-flash")!.price
  const usd = (tok.embed * EMBEDDING_PRICE_USD_PER_M + tok.sumIn * flash.input + tok.sumOut * flash.output) / 1_000_000
  const krw = usdToKrw(usd)

  console.log("\n── 적재 결과 ──")
  console.log(`문서: 올린 것 ${manifest.docs.filter((d) => d.knowledgeId).length}/${manifest.docs.length} · 파싱 완료 ${all.filter((k) => k.parse_status === "completed").length} · 파싱 실패 ${failed.length} · 요약 완료 ${summarized} · 요약 실패 ${summaryFailed.length}`)
  console.log(`청크 (종류|수|글자):\n${chunkRows.split("\n").map((l) => `  ${l}`).join("\n")}`)
  console.log(`임베딩 차원|수: ${dimRows.replace(/\n/g, " · ")}`)
  console.log(`걸린 시간: ${elapsedS}s (업로드 시작 → 모든 파싱·요약 끝)`)
  console.log(`토큰: 임베딩 ${tok.embed.toLocaleString()} (추정, 글자 수/4) · 요약 ${fromLogs ? `${logged.calls}회 (앱 로그 실측)` : "(추정, 글자 수/4)"} 입력 ${tok.sumIn.toLocaleString()} · 출력 ${tok.sumOut.toLocaleString()} → $${usd.toFixed(4)} ≈ ${krw}원`)
  for (const f of failed.slice(0, 10)) console.log(`  ✗ ${f.file_name ?? f.id}: ${(f.error_message ?? "").slice(0, 160)}`)

  appendLedger({
    kind: "run", runId: "wk-real-ingest", krw,
    note: `임베딩 ${tok.embed} tok 추정(글자 수/4) @ $${EMBEDDING_PRICE_USD_PER_M}/1M + 요약 gemini-3.8-flash ${fromLogs ? `앱 로그 실측 ${logged.calls}회` : "추정(글자 수/4)"} 입력 ${tok.sumIn} · 출력 ${tok.sumOut} tok · 문서 ${all.length} · ${elapsedS}s`,
  })
  console.log("ledger 기록: wk-real-ingest")
}

async function upload(kbId: string, d: ManifestDoc, auth: ReturnType<typeof apiAuth>, dir: string): Promise<string> {
  const form = new FormData()
  form.set("file", new Blob([readFileSync(join(dir, d.file))], { type: "text/markdown" }), d.file)
  form.set("metadata", JSON.stringify({
    omnis_kind: d.kind,
    ...(d.source ? { omnis_source: d.source, omnis_source_id: d.sourceId } : {}),
    omnis_message_count: String(d.messages.length),
  }))
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await wkForm<{ success?: boolean; data?: { id: string }; error?: unknown }>(`/knowledge-bases/${kbId}/knowledge/file`, auth, form)
    // 409 = 같은 파일이 이미 있다 — data 가 기존 knowledge
    if ((r.status === 200 || r.status === 201 || r.status === 409) && r.json.data?.id) return r.json.data.id
    if (r.status < 500 && r.status !== 429) throw new Error(`${r.status} ${JSON.stringify(r.json).slice(0, 200)}`)
    await new Promise((res) => setTimeout(res, 2000 * 2 ** attempt))
  }
  throw new Error("업로드 재시도 한도")
}

async function listKnowledge(kbId: string, auth: ReturnType<typeof apiAuth>): Promise<Knowledge[]> {
  const out: Knowledge[] = []
  for (let page = 1; ; page++) {
    const r = await wkJson<{ data: Knowledge[]; total: number }>("GET", `/knowledge-bases/${kbId}/knowledge?page=${page}&page_size=100`, auth)
    out.push(...(r.data ?? []))
    if (!r.data?.length || out.length >= r.total) break
  }
  return out
}

main().catch((err) => { console.error(err); process.exitCode = 1 })
