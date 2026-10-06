// WeKnora 검색 기법을 누적으로 얹은 검색기 — R1a · R1b · R2 · R3 · R4.
//
//   R1a  벡터 20 + 키워드 20(pg_trgm 점수) → 가중 RRF(k=60). 기본 0.5/0.5 — WeKnora 기본 0.7/0.3 은 env 로 (아래 W_VECTOR)
//   R1b  같은 구조, 키워드 점수만 BM25 근사
//   R2   R1(R_BEST_KEYWORD) + 질의 이해(재작성·의도) + 벡터 유사도가 낮을 때만 키워드 쪽 확장
//   R3   R2 + 상위 30 LLM 리랭크 + MMR(λ=0.7) → top-k
//   R4   R3 + 부모 확장 (순위는 R3 와 같다. 생성 방법에서만 의미)
//
// 모든 단계에서 프로덕션 withFollowUps(채팅 조각 뒤 이후 대화)를 R0-hybrid 와 똑같이 붙인다 —
// R0 → R1 사이에 바뀌는 조건을 키워드 점수·가중치 하나로 두기 위해서다. R4 는 그 위에 앞 대화·업무 상세를 더한다.
//
// lib/ 프로덕션 함수는 고치지 않고 import 해 쓴다. 계획: mydocs/plans/2026-10-06-weknora-lab.md
import { prisma } from "@/lib/db"
import { retrieveContext, extractKeywords, withFollowUps, type RetrievedChunk } from "@/lib/embeddings"
import { addUsage, now, ZERO_USAGE, type Usage } from "../providers"
import { keywordSearch, type KeywordScorer, type KwRow } from "./keyword"
import { understandQuery, llmRerank, type Intent } from "./llm"

export const WK_LEVELS = ["r1a", "r1b", "r2", "r3", "r4"] as const
export type WkLevel = (typeof WK_LEVELS)[number]

/** R2 이상이 쓰는 키워드 점수. R1a · R1b 검색 지표를 본 뒤 고른다 (WK_KEYWORD=trgm|bm25 로 덮는다) */
export const R_BEST_KEYWORD: KeywordScorer = process.env.WK_KEYWORD === "bm25" ? "bm25" : "trgm"

/**
 * WeKnora 기본값 (types/retrieval_config.go GetEffectiveRRFK · GetEffectiveRRFWeights).
 * 0.7 / 0.3 이면 키워드로만 잡힌 1위(0.3/61)가 벡터 8위(0.7/68)보다 낮아 상위 8 에 못 든다 —
 * 정확 문자열 문항에서 Recall 이 벡터만과 같아진 원인(2026-10-06 실측). 가중치를 떼어 재려고 env 로 덮는다.
 */
const RRF_K = 60
// 기본값은 실측 최선(동일 가중). WeKnora 기본을 재려면 WK_W_VECTOR=0.7 WK_W_KEYWORD=0.3.
const W_VECTOR = Number(process.env.WK_W_VECTOR ?? 0.5)
const W_KEYWORD = Number(process.env.WK_W_KEYWORD ?? 0.5)

/** 1차 벡터 검색 1위 유사도가 이보다 낮으면 recall 이 낮다고 보고 키워드 쪽만 확장한다 */
export const EXPAND_BELOW = 0.55
/** 확장 변형 최대 수 (WeKnora expandQueries 와 같다) */
const EXPAND_MAX = 5

/** 리랭크 후보 수 · MMR λ (WeKnora reranking.DefaultMMRLambda) */
const RERANK_POOL = 30
const MMR_LAMBDA = 0.7

const VECTOR_LIMIT = 20

export interface WkChunk extends RetrievedChunk {
  /** 최종 순위 점수 — R1·R2 는 정규화한 가중 RRF(0~1), R3 이상은 리랭크 합성 점수 */
  score: number
}

export interface WkStageMs { rewrite: number; vector: number; keyword: number; expand: number; rerank: number; parent: number }

export interface WkStats {
  ms: WkStageMs
  /** 검색 단계 LLM 사용량(flash-lite) · USD */
  usage: Usage
  costUsd: number
  llmCalls: number
  /** 실제로 검색에 쓴 질의 (R2 이상은 재작성 질의) */
  query: string
  intent?: Intent
  keywords: string[]
  /** 확장했다면 그 변형들 */
  expanded?: string[]
  topVector: number
  /** 리랭크 응답을 JSON 으로 못 읽었으면 false */
  rerankParsed?: boolean
}

export interface WkResult { chunks: WkChunk[]; stats: WkStats }

const rank = (lv: WkLevel) => WK_LEVELS.indexOf(lv)

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t0 = now()
  const v = await fn()
  return [v, now() - t0]
}

// ─── 가중 RRF ───────────────────────────────────────────────────
//
// WeKnora knowledgebase_search_fusion.go fuseWithRRF 와 같은 식: 목록마다 1-기반 순위, 같은 종류의 목록이
// 여럿이면(확장 결과) 가장 좋은 순위만 쓴다(bestRanks). 점수 = (wv/(k+rv) + wk/(k+rk)) / ((wv+wk)/(k+1)).
// 메타데이터는 벡터 쪽 행을 우선한다 — 키워드로만 잡힌 청크의 similarity 는 0.

function bestRanks(lists: { id: string }[][]): Map<string, number> {
  const m = new Map<string, number>()
  for (const list of lists) list.forEach((r, i) => { const cur = m.get(r.id); if (cur === undefined || i + 1 < cur) m.set(r.id, i + 1) })
  return m
}

export function fuseWeightedRrf(vectorLists: RetrievedChunk[][], keywordLists: KwRow[][]): WkChunk[] {
  const vr = bestRanks(vectorLists)
  const kr = bestRanks(keywordLists)
  const info = new Map<string, RetrievedChunk>()
  for (const r of vectorLists.flat()) if (!info.has(r.id)) info.set(r.id, r)
  for (const r of keywordLists.flat()) if (!info.has(r.id)) info.set(r.id, { id: r.id, source: r.source, sourceId: r.sourceId, chunkIndex: r.chunkIndex, title: r.title, content: r.content, similarity: 0 })
  const max = (W_VECTOR + W_KEYWORD) / (RRF_K + 1)
  return [...info.values()]
    .map((c) => {
      const v = vr.get(c.id)
      const k = kr.get(c.id)
      const s = (v ? W_VECTOR / (RRF_K + v) : 0) + (k ? W_KEYWORD / (RRF_K + k) : 0)
      return { ...c, score: s / max }
    })
    .sort((a, b) => b.score - a.score)
}

// ─── 키워드 쪽 확장 (R2) ─────────────────────────────────────────
//
// WeKnora query_expansion.go: 불용어 제거·어순 바꾸기 같은 로컬 변형만 만들고(LLM 없음) 키워드 검색만 다시 한다 —
// 변형의 임베딩은 원 질의와 거의 같아 벡터 쪽 recall 을 늘리지 못한다는 이유. 확장 조건은 WeKnora 가
// "결과 수 < EmbeddingTopK" 인데, 여기선 결과 수가 늘 20 이라 "벡터 1위 유사도 < EXPAND_BELOW" 로 바꿨다.
// 한국어용 변형: 조사·어미를 한 번 더 걷기, 이웃 키워드 붙이기("미라지 주문" → "미라지주문"),
// 네 글자 이상 키워드 두 글자에서 떼기("검수사진" → "검수", "사진").

const MORE_ENDINGS = ["하기로", "하는", "했던", "에서", "으로", "까지", "에게", "하고", "해서", "이랑", "은", "는", "이", "가", "을", "를", "의", "에", "도", "로", "들"]

export function keywordVariants(keywords: string[]): string[] {
  const out = new Set<string>()
  for (const k of keywords) {
    for (const p of MORE_ENDINGS) if (k.length > p.length + 1 && k.endsWith(p)) { out.add(k.slice(0, -p.length)); break }
    if (k.length >= 4 && !/[A-Za-z0-9]/.test(k)) { out.add(k.slice(0, 2)); out.add(k.slice(2)) }
  }
  for (let i = 0; i + 1 < keywords.length; i++) out.add(keywords[i] + keywords[i + 1])
  const have = new Set(keywords)
  return [...out].filter((v) => v.length >= 2 && !have.has(v)).slice(0, EXPAND_MAX)
}

// ─── MMR (R3) ─────────────────────────────────────────────────
//
// WeKnora reranking/mmr.go: 관련도 = 리랭크 합성 점수, 중복도 = 후보 본문 토큰 집합의 자카드.
// 여기선 중복도를 DB 임베딩 코사인으로 잰다 (요청대로). 임베딩이 없는 쌍만 문자 trigram 자카드로 근사한다.
// 탐욕 선택이라 앞 k 개는 k 와 무관하게 같다 — 검색 평가의 top-10 과 생성의 top-8 이 같은 순서를 공유한다.

async function pairwiseCosine(ids: string[]): Promise<Map<string, number>> {
  const rows = await prisma.$queryRawUnsafe<{ a: string; b: string; sim: number }[]>(
    `SELECT a."id" AS a, b."id" AS b, (1 - (a."embedding" <=> b."embedding"))::float8 AS sim
     FROM "EmbeddingChunk" a JOIN "EmbeddingChunk" b ON a."id" < b."id"
     WHERE a."id" = ANY($1::text[]) AND b."id" = ANY($1::text[]) AND a."embedding" IS NOT NULL AND b."embedding" IS NOT NULL`,
    ids
  )
  return new Map(rows.map((r) => [`${r.a}|${r.b}`, r.sim]))
}

const trigrams = (s: string) => { const t = new Set<string>(); for (let i = 0; i + 3 <= s.length; i++) t.add(s.slice(i, i + 3)); return t }
function jaccard(a: Set<string>, b: Set<string>) { let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n || 1) }

async function selectMmr(cands: WkChunk[], k: number): Promise<WkChunk[]> {
  const cos = await pairwiseCosine(cands.map((c) => c.id))
  const tri = new Map<string, Set<string>>()
  const sim = (x: WkChunk, y: WkChunk) => {
    const v = cos.get(x.id < y.id ? `${x.id}|${y.id}` : `${y.id}|${x.id}`)
    if (v !== undefined) return v
    for (const c of [x, y]) if (!tri.has(c.id)) tri.set(c.id, trigrams(c.content))
    return jaccard(tri.get(x.id)!, tri.get(y.id)!)
  }
  const remaining = [...cands]
  const maxRed = new Map<string, number>()
  const out: WkChunk[] = []
  while (out.length < k && remaining.length) {
    let best = 0
    let bestScore = -Infinity
    remaining.forEach((c, i) => { const m = MMR_LAMBDA * c.score - (1 - MMR_LAMBDA) * (maxRed.get(c.id) ?? 0); if (m > bestScore) { bestScore = m; best = i } })
    const [chosen] = remaining.splice(best, 1)
    out.push(chosen)
    for (const c of remaining) maxRed.set(c.id, Math.max(maxRed.get(c.id) ?? 0, sim(c, chosen)))
  }
  return out
}

// ─── 부모 확장 (R4) ─────────────────────────────────────────────
//
// WeKnora 는 parent-child 청킹으로 작은 자식 청크가 걸리면 큰 부모 청크를 컨텍스트로 준다.
// 여기 청크는 문서 단위(업무 1개 · 메시지 1개)라 부모가 따로 없어, 업무는 체크리스트(완료 여부)와 최근 메시지,
// 채팅은 앞 메시지 2개를 붙인다 (이후 대화는 withFollowUps 가 이미 붙였다). LLM 요약은 하지 않는다.

const PARENT_TASK_MSGS = 4
const PARENT_PREV_MSGS = 2
const LINE_CHARS = 150
const when = (d: Date) => d.toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 16)

async function parentExpand(chunks: WkChunk[]): Promise<WkChunk[]> {
  return Promise.all(
    chunks.map(async (c) => {
      if (c.source === "TASK") {
        const [checks, msgs] = await Promise.all([
          prisma.checklist.findMany({ where: { taskId: c.sourceId }, select: { name: true, done: true }, orderBy: { createdAt: "asc" } }),
          prisma.chatMessage.findMany({
            where: { taskId: c.sourceId, kind: "NORMAL", deletedAt: null },
            orderBy: { createdAt: "desc" },
            take: PARENT_TASK_MSGS * 2,
            select: { content: true, createdAt: true, author: { select: { name: true } } },
          }),
        ])
        const recent = msgs.filter((m) => !m.content.startsWith("__")).slice(0, PARENT_TASK_MSGS).reverse()
        const parts = [
          checks.length ? `체크리스트: ${checks.map((x) => `${x.done ? "☑" : "☐"} ${x.name}`).join(", ")}` : "",
          recent.length ? `최근 메시지:\n${recent.map((m) => `[채팅 ${when(m.createdAt)}] ${m.author.name}: ${m.content.trim().slice(0, LINE_CHARS)}`).join("\n")}` : "",
        ].filter(Boolean)
        return parts.length ? { ...c, content: `${c.content}\n[업무 상세]\n${parts.join("\n")}` } : c
      }
      if (c.source === "CHAT_MESSAGE") {
        const head = await prisma.chatMessage.findUnique({ where: { id: c.sourceId }, select: { roomId: true, taskId: true, createdAt: true } })
        if (!head) return c
        const prev = await prisma.chatMessage.findMany({
          where: { ...(head.taskId ? { taskId: head.taskId } : { roomId: head.roomId }), createdAt: { lt: head.createdAt }, kind: "NORMAL", deletedAt: null },
          orderBy: { createdAt: "desc" },
          take: PARENT_PREV_MSGS * 3,
          select: { content: true, createdAt: true, author: { select: { name: true } } },
        })
        const lines = prev.filter((m) => !m.content.startsWith("__")).slice(0, PARENT_PREV_MSGS).reverse()
          .map((m) => `[채팅 ${when(m.createdAt)}] ${m.author.name}: ${m.content.trim().slice(0, LINE_CHARS)}`)
        return lines.length ? { ...c, content: `[앞 대화]\n${lines.join("\n")}\n[걸린 말]\n${c.content}` } : c
      }
      return c
    })
  )
}

// ─── 진입점 ─────────────────────────────────────────────────────

export async function wkRetrieve(level: WkLevel, question: string, limit: number): Promise<WkResult> {
  const ms: WkStageMs = { rewrite: 0, vector: 0, keyword: 0, expand: 0, rerank: 0, parent: 0 }
  let usage = ZERO_USAGE
  let cost = 0
  let llmCalls = 0
  const scorer: KeywordScorer = level === "r1a" ? "trgm" : level === "r1b" ? "bm25" : R_BEST_KEYWORD
  const searchKw = keywordSearch[scorer]

  let query = question.trim()
  let intent: Intent | undefined
  if (rank(level) >= rank("r2")) {
    const u = await understandQuery(query)
    query = u.rewrite
    intent = u.intent
    ms.rewrite = u.ms
    usage = addUsage(usage, u.usage); cost += u.costUsd; llmCalls++
  }

  const keywords = extractKeywords(query)
  const [[vec, vecMs], [kw, kwMs]] = await Promise.all([
    timed(() => retrieveContext(query, { limit: VECTOR_LIMIT, minSimilarity: 0 })),
    timed(() => searchKw(keywords)),
  ])
  ms.vector = vecMs
  ms.keyword = kwMs
  const topVector = vec[0]?.similarity ?? 0

  const keywordLists = [kw]
  let expanded: string[] | undefined
  if (rank(level) >= rank("r2") && topVector < EXPAND_BELOW) {
    expanded = keywordVariants(keywords)
    if (expanded.length) {
      const [rows, t] = await timed(() => searchKw(expanded!))
      keywordLists.push(rows)
      ms.expand = t
    }
  }

  const fused = fuseWeightedRrf([vec], keywordLists)
  let top: WkChunk[]
  let rerankParsed: boolean | undefined
  if (rank(level) >= rank("r3")) {
    const t0 = now()
    const pool = fused.slice(0, RERANK_POOL)
    const rr = await llmRerank(query, pool)
    usage = addUsage(usage, rr.usage); cost += rr.costUsd; llmCalls++
    rerankParsed = rr.parsed
    // WeKnora reranking/rerank.go compositeScore: 0.6 × 모델 점수 + 0.3 × 검색 점수 + 0.1 × 소스 가중(문서 1.0).
    // WeKnora 의 임계값(0.2) 필터와 강등 단계는 두지 않는다 — top-k 를 늘 채운다.
    const scored = pool.map((c, i) => ({ ...c, score: 0.6 * (rr.scores[i] / 10) + 0.3 * c.score + 0.1 })).sort((a, b) => b.score - a.score)
    top = await selectMmr(scored, limit)
    ms.rerank = now() - t0
  } else {
    top = fused.slice(0, limit)
  }

  // 프로덕션 retrieveHybrid 와 같게 채팅 조각에 이후 대화를 붙인다 (similarity·score 는 그대로)
  const followed = (await withFollowUps(top)) as WkChunk[]
  let chunks = followed
  if (level === "r4") {
    const t0 = now()
    chunks = await parentExpand(followed)
    ms.parent = now() - t0
  }

  return { chunks, stats: { ms, usage, costUsd: cost, llmCalls, query, intent, keywords, expanded, topVector, rerankParsed } }
}
