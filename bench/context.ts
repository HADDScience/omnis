// 컨텍스트 조립 — 검색·현황·통째 말뭉치. 방법론(methods.ts)이 여기서 재료를 가져간다.
//
// 프로덕션과 같은 함수(retrieveContext · build*Overview)를 그대로 부르고 시간을 잰다.
// 벤치가 프로덕션과 다른 길로 자료를 만들면 비교가 무의미하다.
import { prisma } from "@/lib/db"
import { retrieveContext, sectionToText, type RetrievedChunk, type EmbeddingSource } from "@/lib/embeddings"
import { buildTaskOverview, buildIpOverview, buildCrmOverview, SOURCE_LABEL } from "@/lib/omnis-ask"
import { migrateContent } from "@/lib/omnis-types"
import { now } from "./providers"

export interface Timed<T> {
  value: T
  ms: number
}

export async function timed<T>(fn: () => Promise<T>): Promise<Timed<T>> {
  const t0 = now()
  const value = await fn()
  return { value, ms: now() - t0 }
}

export interface RefChunk {
  title: string
  content: string
  sourceLabel: string
  source: EmbeddingSource
  similarity: number
}

export function toRef(c: RetrievedChunk): RefChunk {
  return { title: c.title, content: c.content, sourceLabel: SOURCE_LABEL[c.source], source: c.source, similarity: c.similarity }
}

// ─── 벡터 검색 (프로덕션 그대로) ──────────────────────────────────

export async function vectorSearch(question: string, limit = 8, minSimilarity = 0.3): Promise<Timed<RefChunk[]>> {
  return timed(async () => (await retrieveContext(question, { limit, minSimilarity })).map(toRef))
}

// ─── 키워드 + 벡터 하이브리드 (RRF) ─────────────────────────────

const STOP = new Set([
  "어디까지", "진행", "진행됐어", "됐어", "어떻게", "뭐야", "누가", "언제", "어느", "어땠어", "결과", "건은", "건에서",
  "이랑", "그리고", "대해", "대한", "관련", "최근", "올린", "무엇", "뭘", "했고", "했어", "정했어", "있었어", "하기로",
])

/**
 * 질문에서 검색어를 뽑는다. 형태소 분석 없이 조사만 걷어내는 거친 방식이다.
 * "케이바이오랩스 검수사진이랑" → "케이바이오랩스", "검수사진".
 */
export function extractKeywords(question: string): string[] {
  const raw = question.replace(/[?？!.,·()\[\]"'“”]/g, " ").split(/\s+/).filter(Boolean)
  const out = new Set<string>()
  for (const tok of raw) {
    let t = tok
    for (const p of ["이랑", "에서는", "에서", "으로", "은요", "는요", "이야", "이나", "까지", "부터", "에게", "한테", "처럼", "보다", "은", "는", "이", "가", "을", "를", "의", "에", "도", "로", "과", "와", "랑"]) {
      if (t.length > p.length + 1 && t.endsWith(p)) { t = t.slice(0, -p.length); break }
    }
    if (t.length < 2 || STOP.has(t) || STOP.has(tok)) continue
    if (/^\d+$/.test(t)) continue
    out.add(t)
  }
  return [...out]
}

interface KeywordRow { id: string; source: EmbeddingSource; sourceId: string; chunkIndex: number; title: string; content: string; hits: number }

export async function hybridSearch(question: string, limit = 8): Promise<Timed<RefChunk[]> & { keywords: string[] }> {
  const keywords = extractKeywords(question)
  const t = await timed(async () => {
    const [vec, kw] = await Promise.all([
      retrieveContext(question, { limit: 20, minSimilarity: 0 }),
      keywords.length === 0
        ? Promise.resolve([] as KeywordRow[])
        : prisma.$queryRawUnsafe<KeywordRow[]>(
            `SELECT "id","source","sourceId","chunkIndex","title","content",
                    (${keywords.map((_, i) => `(CASE WHEN "content" ILIKE $${i + 1} OR "title" ILIKE $${i + 1} THEN 1 ELSE 0 END)`).join(" + ")}) AS hits
             FROM "EmbeddingChunk"
             WHERE ${keywords.map((_, i) => `"content" ILIKE $${i + 1} OR "title" ILIKE $${i + 1}`).join(" OR ")}
             ORDER BY hits DESC, "updatedAt" DESC
             LIMIT 20`,
            ...keywords.map((k) => `%${k}%`)
          ),
    ])
    // RRF: 두 목록의 순위를 1/(60+rank) 로 더한다. 점수 스케일이 달라도 섞인다.
    const score = new Map<string, { s: number; row: RetrievedChunk | KeywordRow }>()
    const add = (rows: (RetrievedChunk | KeywordRow)[]) =>
      rows.forEach((r, i) => {
        const cur = score.get(r.id)
        score.set(r.id, { s: (cur?.s ?? 0) + 1 / (60 + i + 1), row: cur?.row ?? r })
      })
    add(vec)
    add(kw)
    return [...score.values()]
      .sort((a, b) => b.s - a.s)
      .slice(0, limit)
      .map(({ row }) => ({
        title: row.title,
        content: row.content,
        sourceLabel: SOURCE_LABEL[row.source],
        source: row.source,
        similarity: "similarity" in row ? row.similarity : 0,
      }))
  })
  return { ...t, keywords }
}

// ─── 현황 전량 (프로덕션 그대로, 매번 새로 만든다) ───────────────────

export async function overviews(): Promise<Timed<string>> {
  return timed(async () => {
    const [task, ip, crm] = await Promise.all([buildTaskOverview(), buildIpOverview(), buildCrmOverview()])
    return [task, ip, crm].filter(Boolean).join("\n\n")
  })
}

// ─── 통째 말뭉치 — 검색 없이 전부 넣는 방식의 재료 (한 번 만들어 재사용) ───────

let stuffCache: Promise<{ text: string; chars: number; parts: Record<string, number> }> | null = null

export function stuffCorpus(chatDays = 60, maxChars = 250_000) {
  if (stuffCache) return stuffCache
  stuffCache = (async () => {
    const since = new Date(Date.now() - chatDays * 86_400_000)
    const [ov, cards, messages] = await Promise.all([
      overviews(),
      prisma.omnisCard.findMany({ include: { category: { select: { name: true } } }, orderBy: { updatedAt: "desc" } }),
      prisma.chatMessage.findMany({
        where: { createdAt: { gte: since } },
        select: { content: true, createdAt: true, author: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      }),
    ])
    const cardText = cards
      .map((c) => {
        const body = migrateContent(c.content).sections.map((s) => sectionToText(s).trim()).filter(Boolean).join("\n")
        return `## [${c.category.name}] ${c.title}\n${body}`
      })
      .join("\n\n")
    let chatText = messages
      .map((m) => `[${m.createdAt.toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 16)}] ${m.author?.name ?? "?"}: ${m.content}`)
      .join("\n")
    const fixed = `[현황 자료]\n${ov.value}\n\n[지식 카드 전문]\n${cardText}\n\n[최근 ${chatDays}일 채팅]\n`
    if (fixed.length + chatText.length > maxChars) chatText = chatText.slice(chatText.length - (maxChars - fixed.length))  // 오래된 것부터 버린다
    const text = fixed + chatText
    return { text, chars: text.length, parts: { overview: ov.value.length, cards: cardText.length, chat: chatText.length, messages: messages.length } }
  })()
  return stuffCache
}
