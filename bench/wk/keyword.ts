// 키워드 쪽 점수 — R1a(pg_trgm) · R1b(BM25 근사).
//
// 후보 집합은 프로덕션 retrieveHybrid 와 같다 (content 또는 title 에 키워드가 ILIKE 로 들어 있는 청크).
// 바뀌는 것은 순위를 매기는 점수뿐이다 — 프로덕션은 "몇 개 키워드가 걸렸나"(정수) + 최신순.
// WeKnora 는 ParadeDB BM25(pg_search) 로 키워드 검색을 한다 (retriever/postgres). Neon 은 pg_search 를 끝냈고
// (lib/embeddings.ts 주석), 이 실험은 확장 없이 SQL 로 근사한다.
import { prisma } from "@/lib/db"
import type { EmbeddingSource } from "@/lib/embeddings"

export interface KwRow { id: string; source: EmbeddingSource; sourceId: string; chunkIndex: number; title: string; content: string; score: number }
export type KeywordScorer = "trgm" | "bm25"

/** 키워드 목록 하나에서 가져오는 수. 프로덕션 하이브리드와 같다 */
const KW_LIMIT = 20

/** LIKE 메타문자(% _ \)를 이스케이프한다. 프로덕션은 하지 않는다 — 키워드에 _ 가 들어오면 아무 글자로 읽힌다 */
const likePattern = (k: string) => `%${k.replace(/[\\%_]/g, "\\$&")}%`

/** $1..$n 이 패턴일 때 content/title ILIKE OR 조건. GIN(gin_trgm_ops) 이 BitmapOr 로 받는다 (bench/wk/setup.sql) */
const candidateWhere = (n: number) =>
  Array.from({ length: n }, (_, i) => `"content" ILIKE $${i + 1} OR "title" ILIKE $${i + 1}`).join(" OR ")

/**
 * R1a — 키워드별 word_similarity(k, content) + 0.5 × word_similarity(k, title) 의 합.
 * word_similarity 는 키워드 trigram 중 본문의 가장 비슷한 연속 구간과 겹치는 비율이다 —
 * "애드젤" 이 "애드젤의" 안에 있으면 1 보다 조금 낮고, 띄어 쓴 "애드젤" 이면 1.
 */
export async function trgmSearch(keywords: string[]): Promise<KwRow[]> {
  if (keywords.length === 0) return []
  const n = keywords.length
  return prisma.$queryRawUnsafe<KwRow[]>(
    `SELECT "id","source","sourceId","chunkIndex","title","content",
            (${keywords.map((_, i) => `word_similarity($${n + i + 1}, "content") + 0.5 * word_similarity($${n + i + 1}, "title")`).join(" + ")})::float8 AS score
     FROM "EmbeddingChunk"
     WHERE ${candidateWhere(n)}
     ORDER BY score DESC, "updatedAt" DESC
     LIMIT ${KW_LIMIT}`,
    ...keywords.map(likePattern),
    ...keywords
  )
}

// ─── R1b BM25 근사 ────────────────────────────────────────────────
//
// 문서 = 청크 content. 길이 = 글자 수(토큰 수가 아니다 — 형태소 분석이 없어서). tf = 본문 안 키워드 출현 횟수
// (대소문자 무시, 문자열 길이 차로 센다). df = 키워드가 든 청크 수. BM25 의 "단어" 가 여기선 부분 문자열이라
// "애드젤" 은 "애드젤의" 안에서도 센다.

const K1 = 1.2
const B = 0.75

let corpus: Promise<{ n: number; avgdl: number }> | null = null

/** 전체 청크 수와 평균 길이. 실행 동안 한 번만 센다 */
function corpusStats() {
  corpus ??= prisma
    .$queryRawUnsafe<{ n: number; avgdl: number }[]>(`SELECT count(*)::int AS n, avg(length("content"))::float8 AS avgdl FROM "EmbeddingChunk"`)
    .then((r) => r[0])
  return corpus
}

export async function bm25Search(keywords: string[]): Promise<KwRow[]> {
  if (keywords.length === 0) return []
  const n = keywords.length
  const pats = keywords.map(likePattern)
  const [{ n: N, avgdl }, [dfRow]] = await Promise.all([
    corpusStats(),
    prisma.$queryRawUnsafe<Record<string, number>[]>(
      `SELECT ${pats.map((_, i) => `count(*) FILTER (WHERE "content" ILIKE $${i + 1})::int AS d${i}`).join(", ")}
       FROM "EmbeddingChunk" WHERE ${Array.from({ length: n }, (_, i) => `"content" ILIKE $${i + 1}`).join(" OR ")}`,
      ...pats
    ),
  ])
  const idf = keywords.map((_, i) => { const df = dfRow[`d${i}`] ?? 0; return Math.log(1 + (N - df + 0.5) / (df + 0.5)) })
  // tf_i 를 서브쿼리에서 한 번 계산하고 바깥에서 BM25 항으로 합친다. idf·avgdl 은 계산된 숫자라 리터럴로 넣는다.
  const tf = (i: number) => `((length(lower("content")) - length(replace(lower("content"), lower($${n + i + 1}), ''))) / length($${n + i + 1}))::float8 AS tf${i}`
  const term = (i: number) => `${idf[i]} * tf${i} * ${K1 + 1} / (tf${i} + ${K1} * (1 - ${B} + ${B} * dl / ${avgdl}))`
  return prisma.$queryRawUnsafe<KwRow[]>(
    `SELECT "id","source","sourceId","chunkIndex","title","content", (${keywords.map((_, i) => term(i)).join(" + ")})::float8 AS score
     FROM (
       SELECT "id","source","sourceId","chunkIndex","title","content","updatedAt", length("content")::float8 AS dl, ${keywords.map((_, i) => tf(i)).join(", ")}
       FROM "EmbeddingChunk"
       WHERE ${candidateWhere(n)}
     ) t
     ORDER BY score DESC, "updatedAt" DESC
     LIMIT ${KW_LIMIT}`,
    ...pats,
    ...keywords
  )
}

export const keywordSearch: Record<KeywordScorer, (keywords: string[]) => Promise<KwRow[]>> = { trgm: trgmSearch, bm25: bm25Search }
