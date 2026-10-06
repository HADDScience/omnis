// 검색만 평가 — 생성 모델을 부르지 않고 gold 근거를 얼마나 위로 올리는지 잰다.
//
//   npx tsx bench/retrieval-eval.ts --questions <파일> --retrievers R0-hybrid,vector [--repeat 1] [--out bench/results/<run>]
//
// 지표(문항별, 이진 관련도): Recall@8 · MRR · NDCG@10 · 검색 ms. gold 는 (source, sourceId) 단위로 대조한다.
// 같은 소스의 여러 chunkIndex 는 하나로 합치고 첫 순위를 쓴다. gold 가 빈 문항은 건너뛰고 수를 보고한다.
// 결과: <out>/retrieval.jsonl (문항 × 검색기 × 반복) · retrieval-summary.md (검색기 × 유형 표).
// 계획: mydocs/plans/2026-10-06-weknora-lab.md (단계 1 · 단계 2 의 R-best 선정)
import "dotenv/config"
import { mkdirSync, appendFileSync, writeFileSync } from "fs"
import { join } from "path"
import { prisma } from "@/lib/db"
import { retrieveContext, retrieveHybrid } from "@/lib/embeddings"
import { estimateGeminiTokens } from "@/lib/gemini-usage"
import { EMBEDDING_PRICE_USD_PER_M, KRW_PER_USD, usdToKrw } from "./config"
import { loadQuestions, DEFAULT_TYPE, type GoldRef } from "./questions"
import { appendLedger } from "./ledger"
import { now } from "./providers"

export interface Hit { source: string; sourceId: string; score?: number }
export type Retriever = (q: string) => Promise<Hit[]>

/** 한 번에 가져오는 청크 수. NDCG@10 을 재려면 10 개가 필요하다 (프로덕션 top-8 은 이 중 앞 8 개와 같다) */
const FETCH = 10
const K_RECALL = 8
const K_NDCG = 10

/**
 * 검색기 레지스트리 — R1~R4 는 여기에 한 줄씩 더한다. 이름이 --retrievers 값이다.
 * 반환은 순위순(1위가 앞). score 는 있으면 기록만 하고 지표에는 쓰지 않는다.
 */
export const retrievers: Record<string, Retriever> = {
  // 프로덕션 retrieveHybrid 그대로 (벡터 20 + ILIKE 20 → 동일 가중 RRF k=60)
  "R0-hybrid": async (q) => (await retrieveHybrid(q, { limit: FETCH })).chunks.map((c) => ({ source: c.source, sourceId: c.sourceId, score: c.similarity })),
  // 벡터만. bench/context.ts 의 vectorSearch 가 부르는 retrieveContext 를 sourceId 를 살려 직접 부른다.
  // minSimilarity 0 — 컷오프로 순위가 잘리면 지표가 검색기 비교가 아니라 임계값 비교가 된다.
  vector: async (q) => (await retrieveContext(q, { limit: FETCH, minSimilarity: 0 })).map((c) => ({ source: c.source, sourceId: c.sourceId, score: c.similarity })),
}

// ─── 지표 ──────────────────────────────────────────────────────

const keyOf = (h: GoldRef) => `${h.source}|${h.sourceId}`

/** (source, sourceId) 단위로 합친다. 먼저 나온 순위를 남긴다 */
export function dedupeHits(hits: Hit[]): Hit[] {
  const seen = new Set<string>()
  return hits.filter((h) => { const k = keyOf(h); if (seen.has(k)) return false; seen.add(k); return true })
}

export interface Metrics { recall8: number; mrr: number; ndcg10: number }

export function metrics(ranked: Hit[], gold: GoldRef[]): Metrics {
  const goldKeys = new Set(gold.map(keyOf))
  const keys = ranked.map(keyOf)
  const recall8 = keys.slice(0, K_RECALL).filter((k) => goldKeys.has(k)).length / goldKeys.size
  const first = keys.findIndex((k) => goldKeys.has(k))
  const mrr = first >= 0 ? 1 / (first + 1) : 0
  const dcg = keys.slice(0, K_NDCG).reduce((a, k, i) => a + (goldKeys.has(k) ? 1 / Math.log2(i + 2) : 0), 0)
  const ideal = Array.from({ length: Math.min(goldKeys.size, K_NDCG) }, (_, i) => 1 / Math.log2(i + 2)).reduce((a, b) => a + b, 0)
  return { recall8, mrr, ndcg10: ideal > 0 ? dcg / ideal : 0 }
}

// ─── 질문 임베딩 캐시 + 토큰 집계 ───────────────────────────────
//
// 프로덕션 검색 함수는 질문 임베딩을 내부에서 fetch 로 만든다. 함수를 고치지 않고 fetch 를 감싸
// 같은 (검색기, 요청 본문) 이면 이전 응답을 돌려준다. 검색기마다 따로 캐시한다 —
// 첫 반복의 ms 가 검색기 사이에서 같은 조건(임베딩 포함)이 되도록.

const EMBED_URL = "batchEmbedContents"
const embedCache = new Map<string, string>()
let embedScope = ""
const embedStat = { calls: 0, hits: 0, tokens: 0 }

function installEmbedCache() {
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    if (!url.includes(EMBED_URL) || typeof init?.body !== "string") return realFetch(input, init)
    embedStat.calls++
    const key = `${embedScope}|${init.body}`
    const hit = embedCache.get(key)
    if (hit !== undefined) {
      embedStat.hits++
      return new Response(hit, { status: 200, headers: { "content-type": "application/json" } })
    }
    const res = await realFetch(input, init)
    if (res.ok) {
      const text = await res.clone().text()
      embedCache.set(key, text)
      // 사용량이 응답에 없으면 프로덕션(lib/ai.ts)과 같은 추정식으로 센다
      const usage = (JSON.parse(text) as { usageMetadata?: { promptTokenCount?: number; totalTokenCount?: number } }).usageMetadata
      const texts = (JSON.parse(init.body) as { requests: { content: { parts: { text: string }[] } }[] }).requests.map((r) => r.content.parts[0].text)
      embedStat.tokens += usage?.promptTokenCount ?? usage?.totalTokenCount ?? estimateGeminiTokens(texts)
    }
    return res
  }) as typeof fetch
}

// ─── 실행 ──────────────────────────────────────────────────────

export interface EvalRow {
  runId: string
  retriever: string
  qid: string
  type: string
  question: string
  repeat: number
  goldN: number
  /** 중복을 합친 순위 (앞 10) */
  ranked: Hit[]
  recall8: number
  mrr: number
  ndcg10: number
  ms: number
  /** 질문 임베딩을 캐시에서 받았는가 — true 면 ms 에 임베딩 호출이 없다 */
  cached: boolean
  error?: string
  at: string
}

const args = process.argv.slice(2)
const opt = (k: string): string | undefined => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined }

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const f3 = (x: number) => x.toFixed(3)

async function main() {
  const qFile = opt("--questions") ?? process.env.BENCH_QUESTIONS
  if (!qFile) throw new Error("--questions <파일> 을 주세요")
  const names = (opt("--retrievers") ?? "R0-hybrid,vector").split(",").map((s) => s.trim()).filter(Boolean)
  const unknown = names.filter((n) => !retrievers[n])
  if (unknown.length) throw new Error(`모르는 검색기: ${unknown.join(", ")}. 가능한 값: ${Object.keys(retrievers).join(", ")}`)
  const repeat = Math.max(1, Number(opt("--repeat") ?? 1))
  installEmbedCache()

  const dbHost = (process.env.DATABASE_URL ?? "").replace(/.*@/, "").replace(/\/.*/, "")
  const runId = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "").replace(/(\d{8})(\d{4})/, "$1-$2")
  const dir = opt("--out") ?? join("bench/results", `retrieval-${runId}`)
  mkdirSync(dir, { recursive: true })
  const outFile = join(dir, "retrieval.jsonl")
  writeFileSync(outFile, "")

  const all = loadQuestions(qFile)
  const questions = all.filter((q) => q.gold && q.gold.length > 0)
  const skipped = all.length - questions.length
  console.log(`retrieval ${runId} · DB ${dbHost} · 검색기 ${names.join(", ")} · 질문 ${questions.length}개 (gold 없음 ${skipped}개 건너뜀) × 반복 ${repeat}`)

  const rows: EvalRow[] = []
  for (let rep = 1; rep <= repeat; rep++) {
    for (const name of names) {
      for (const q of questions) {
        embedScope = name
        embedStat.calls = 0; embedStat.hits = 0
        const t0 = now()
        let ranked: Hit[] = []
        let error: string | undefined
        try { ranked = dedupeHits(await retrievers[name](q.q)).slice(0, K_NDCG) } catch (err) { error = String(err).slice(0, 300) }
        const ms = Math.round(now() - t0)
        const m = error ? { recall8: 0, mrr: 0, ndcg10: 0 } : metrics(ranked, q.gold!)
        const row: EvalRow = {
          runId, retriever: name, qid: q.id, type: q.type ?? DEFAULT_TYPE, question: q.q, repeat: rep, goldN: new Set(q.gold!.map(keyOf)).size,
          ranked, ...m, ms, cached: embedStat.calls > 0 && embedStat.hits === embedStat.calls, error, at: new Date().toISOString(),
        }
        rows.push(row)
        appendFileSync(outFile, JSON.stringify(row) + "\n")
        console.log(`[${rep}/${repeat}] ${name.padEnd(10)} ${q.id.padEnd(4)} R@8 ${f3(m.recall8)} MRR ${f3(m.mrr)} NDCG ${f3(m.ndcg10)}  ${ms}ms${row.cached ? " (임베딩 캐시)" : ""}${error ? `  ✗ ${error.slice(0, 80)}` : ""}`)
      }
    }
  }

  const krw = usdToKrw((embedStat.tokens * EMBEDDING_PRICE_USD_PER_M) / 1_000_000)
  appendLedger({ kind: "retrieval", runId: `retrieval-${runId}`, krw, note: `임베딩 ${embedStat.tokens} tok @ $${EMBEDDING_PRICE_USD_PER_M}/1M (추정)` })
  writeFileSync(join(dir, "retrieval-summary.md"), summarize({ runId, dbHost, qFile, names, repeat, total: all.length, skipped, rows, tokens: embedStat.tokens, krw }))
  console.log(`\n임베딩 ${embedStat.tokens} tok ≈ ${krw}원 (ledger 기록)\n결과: ${join(dir, "retrieval-summary.md")}`)
}

interface SummaryInput { runId: string; dbHost: string; qFile: string; names: string[]; repeat: number; total: number; skipped: number; rows: EvalRow[]; tokens: number; krw: number }

function summarize(s: SummaryInput): string {
  const ok = s.rows.filter((r) => !r.error)
  const line = (label: string, rs: EvalRow[]) => {
    const warm = rs.filter((r) => !r.cached)
    const cold = rs.filter((r) => r.cached)
    return `| ${label} | ${new Set(rs.map((r) => r.qid)).size} | **${f3(avg(rs.map((r) => r.recall8)))}** | ${f3(avg(rs.map((r) => r.mrr)))} | ${f3(avg(rs.map((r) => r.ndcg10)))} | ${warm.length ? Math.round(avg(warm.map((r) => r.ms))) : "-"} | ${cold.length ? Math.round(avg(cold.map((r) => r.ms))) : "-"} |`
  }
  const head = ["| 검색기 · 유형 | 문항 | Recall@8 | MRR | NDCG@10 | ms (임베딩 포함) | ms (임베딩 캐시) |", "|---|--:|--:|--:|--:|--:|--:|"]
  const types = [...new Set(ok.map((r) => r.type))].sort()
  const body = s.names.flatMap((n) => {
    const mine = ok.filter((r) => r.retriever === n)
    return [line(`**${n}** 전체`, mine), ...types.filter((t) => mine.some((r) => r.type === t)).map((t) => line(`${n} · ${t}`, mine.filter((r) => r.type === t)))]
  })
  const errors = s.rows.length - ok.length
  return [
    `# 검색 평가 ${s.runId}`,
    "",
    `DB ${s.dbHost} · 질문 ${s.total}개 중 gold 있는 ${s.total - s.skipped}개 평가, ${s.skipped}개 건너뜀 (${s.qFile}) · 반복 ${s.repeat} · 오류 ${errors}`,
    "",
    `Recall@8 = 상위 8 소스 중 gold 비율. MRR = 첫 gold 순위의 역수. NDCG@10 = 이진 관련도. 소스 = (source, sourceId), 같은 소스의 여러 청크는 첫 순위만 센다.`,
    `ms 는 검색 함수 호출 전체(임베딩 호출 + DB). 임베딩 캐시 열은 같은 질문의 두 번째 반복부터라 임베딩 호출이 빠진 값이다 (반복 1 이면 "-").`,
    "",
    ...head, ...body,
    "",
    `임베딩 비용(추정): ${s.tokens.toLocaleString()} tok × $${EMBEDDING_PRICE_USD_PER_M}/1M × ${KRW_PER_USD}원/$ ≈ ${s.krw}원. 단가는 확인 필요 (config.ts).`,
    "",
  ].join("\n")
}

if (process.argv[1]?.endsWith("retrieval-eval.ts")) {
  main()
    .catch((err) => { console.error(err); process.exitCode = 1 })
    .finally(() => prisma.$disconnect())
}
