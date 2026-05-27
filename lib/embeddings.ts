import { createHash } from "crypto"
import { prisma } from "@/lib/db"
import { embedTexts } from "@/lib/ai"
import { migrateContent, type Section } from "@/lib/omnis-types"
import { TASK_STATUS_LABELS } from "@/lib/constants"

// ─── 임베딩 동기화 & 벡터 검색 ───────────────────────────
//
// EmbeddingChunk 테이블의 embedding 컬럼은 Prisma 미지원 타입(vector)이라
// 벡터 read/write는 raw SQL로 처리한다. 메타데이터(title/content/hash 등)는
// 일반 Prisma 클라이언트로 다룬다.

export type EmbeddingSource =
  | "OMNIS_CARD"
  | "TASK"
  | "WEEKLY_REPORT"
  | "CHAT_MESSAGE"

const ALL_SOURCES: EmbeddingSource[] = [
  "OMNIS_CARD",
  "TASK",
  "WEEKLY_REPORT",
  "CHAT_MESSAGE",
]

/** 채팅 메시지 임베딩 최소 길이 (짧은 잡담 제외) */
const CHAT_MIN_LENGTH = 15

interface RawChunk {
  title: string
  content: string
}

// ─── 텍스트 추출 (소스별 청킹) ───────────────────────────

function sectionToText(s: Section): string {
  switch (s.type) {
    case "text":
      return s.body
    case "table":
      return [s.headers.join(" | "), ...s.rows.map((r) => r.join(" | "))].join(
        "\n"
      )
    case "keyvalue":
      return s.pairs
        .filter((p) => p.key || p.value)
        .map((p) => `${p.key}: ${p.value}`)
        .join("\n")
    case "files":
    case "links":
      // 파일/링크 섹션은 ID만 보유 — 임베딩에서 제외
      return ""
  }
}

async function buildOmnisCardChunks(cardId: string): Promise<RawChunk[] | null> {
  const card = await prisma.omnisCard.findUnique({
    where: { id: cardId },
    include: { category: { select: { name: true } } },
  })
  if (!card) return null

  const cc = migrateContent(card.content)
  const head = [card.category?.name, card.title].filter(Boolean).join(" / ")
  const chunks: RawChunk[] = []

  for (const s of cc.sections) {
    const text = sectionToText(s).trim()
    if (!text) continue
    chunks.push({
      title: `${card.title}${s.title ? ` — ${s.title}` : ""}`,
      content: `[옴니스] ${head}\n${s.title ? `${s.title}\n` : ""}${text}`,
    })
  }

  // 섹션이 비어 있어도 제목·태그는 검색되도록 최소 1청크 보장
  if (chunks.length === 0) {
    const tags = card.tags.join(", ")
    chunks.push({
      title: card.title,
      content: `[옴니스] ${head}${tags ? `\n태그: ${tags}` : ""}`,
    })
  }
  return chunks
}

async function buildTaskChunks(taskId: string): Promise<RawChunk[] | null> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      project: { select: { name: true } },
      product: { select: { name: true } },
      checklists: { select: { name: true }, orderBy: { createdAt: "asc" } },
    },
  })
  if (!task || task.archived) return null

  const parts: string[] = []
  parts.push(`상태: ${TASK_STATUS_LABELS[task.status] ?? task.status}`)
  if (task.deadline) {
    const ymd = task.deadline.toISOString().slice(0, 10)
    const overdue =
      task.status !== "DONE" && task.deadline.getTime() < Date.now()
    parts.push(
      overdue
        ? `마감일: ${ymd} — 지연된 업무 (마감일이 지났으나 완료되지 않음)`
        : `마감일: ${ymd}`
    )
  }
  if (task.project?.name) parts.push(`프로젝트: ${task.project.name}`)
  if (task.product?.name) parts.push(`제품: ${task.product.name}`)
  if (task.background) parts.push(`배경: ${task.background}`)
  if (task.expectedResult) parts.push(`기대결과: ${task.expectedResult}`)
  if (task.checklists.length > 0) {
    parts.push(`체크리스트: ${task.checklists.map((c) => c.name).join(", ")}`)
  }

  return [
    {
      title: task.name,
      content: `[업무] ${task.name}\n${parts.join("\n")}`,
    },
  ]
}

async function buildWeeklyReportChunks(
  reportId: string
): Promise<RawChunk[] | null> {
  const report = await prisma.weeklyReport.findUnique({
    where: { id: reportId },
  })
  if (!report) return null

  const c = (report.content ?? {}) as Record<string, unknown>
  const completed = Array.isArray(c.completed) ? (c.completed as string[]) : []
  const inProgress = Array.isArray(c.inProgress)
    ? (c.inProgress as string[])
    : []

  const parts: string[] = []
  if (completed.length > 0) parts.push(`완료: ${completed.join(", ")}`)
  if (inProgress.length > 0) parts.push(`진행 중: ${inProgress.join(", ")}`)
  if (typeof c.notes === "string" && c.notes.trim()) {
    parts.push(`비고: ${c.notes.trim()}`)
  }
  if (typeof c.markdown === "string" && c.markdown.trim()) {
    parts.push(c.markdown.trim())
  } else if (typeof c.draft === "string" && c.draft.trim()) {
    parts.push(c.draft.trim())
  }

  const body = parts.join("\n").trim()
  if (!body) return null

  return [{ title: report.title, content: `[주간보고] ${report.title}\n${body}` }]
}

async function buildChatMessageChunks(
  messageId: string
): Promise<RawChunk[] | null> {
  const msg = await prisma.chatMessage.findUnique({
    where: { id: messageId },
    include: { author: { select: { name: true } } },
  })
  if (!msg) return null

  const text = msg.content.trim()
  // 시스템 메시지·플레이스홀더·짧은 잡담 제외
  if (msg.kind !== "NORMAL") return null
  if (text.startsWith("__") || text.startsWith("🤖")) return null
  if (text.length < CHAT_MIN_LENGTH) return null

  return [{ title: `${msg.author.name}의 메시지`, content: text }]
}

async function buildChunks(
  source: EmbeddingSource,
  sourceId: string
): Promise<RawChunk[] | null> {
  switch (source) {
    case "OMNIS_CARD":
      return buildOmnisCardChunks(sourceId)
    case "TASK":
      return buildTaskChunks(sourceId)
    case "WEEKLY_REPORT":
      return buildWeeklyReportChunks(sourceId)
    case "CHAT_MESSAGE":
      return buildChatMessageChunks(sourceId)
  }
}

// ─── 동기화 ──────────────────────────────────────────────

function hashOf(text: string): string {
  return createHash("sha1").update(text).digest("hex")
}

function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`
}

/** 한 엔티티의 모든 임베딩 청크를 삭제한다. */
export async function deleteEmbeddings(
  source: EmbeddingSource,
  sourceId: string
): Promise<void> {
  await prisma.embeddingChunk.deleteMany({ where: { source, sourceId } })
}

/**
 * 한 엔티티의 임베딩을 최신 상태로 동기화한다.
 * - 내용이 바뀐 청크만 재임베딩 (contentHash 비교 → Gemini 호출 절감)
 * - 청크 수가 줄면 남는 청크 삭제
 * - 임베딩 대상이 없으면(soft-delete된 업무 등) 전체 삭제
 */
export async function syncEmbeddings(
  source: EmbeddingSource,
  sourceId: string,
  userId?: string
): Promise<void> {
  const raw = await buildChunks(source, sourceId)
  if (!raw || raw.length === 0) {
    await deleteEmbeddings(source, sourceId)
    return
  }

  const prepared = raw.map((c) => {
    const embedInput = `${c.title}\n${c.content}`
    return { ...c, embedInput, hash: hashOf(embedInput) }
  })

  const existing = await prisma.embeddingChunk.findMany({
    where: { source, sourceId },
    select: { chunkIndex: true, contentHash: true },
  })
  const existingHash = new Map(
    existing.map((e) => [e.chunkIndex, e.contentHash])
  )

  const stale = prepared
    .map((c, index) => ({ c, index }))
    .filter(({ c, index }) => existingHash.get(index) !== c.hash)

  if (stale.length > 0) {
    const vectors = await embedTexts(
      stale.map(({ c }) => c.embedInput),
      "RETRIEVAL_DOCUMENT",
      userId
    )
    for (let k = 0; k < stale.length; k++) {
      const { c, index } = stale[k]
      await prisma.$executeRaw`
        INSERT INTO "EmbeddingChunk"
          ("id", "source", "sourceId", "chunkIndex", "title", "content", "contentHash", "embedding", "createdAt", "updatedAt")
        VALUES
          (gen_random_uuid(), ${source}::"EmbeddingSource", ${sourceId}, ${index}, ${c.title}, ${c.content}, ${c.hash}, ${toVectorLiteral(vectors[k])}::vector, NOW(), NOW())
        ON CONFLICT ("source", "sourceId", "chunkIndex")
        DO UPDATE SET
          "title" = EXCLUDED."title",
          "content" = EXCLUDED."content",
          "contentHash" = EXCLUDED."contentHash",
          "embedding" = EXCLUDED."embedding",
          "updatedAt" = NOW()
      `
    }
  }

  // 청크 수가 줄어든 경우 잉여 청크 제거
  await prisma.embeddingChunk.deleteMany({
    where: { source, sourceId, chunkIndex: { gte: prepared.length } },
  })
}

/**
 * 라우트에서 쓰는 안전 래퍼 — 임베딩 실패가 본 작업(저장)을 막지 않도록
 * 에러를 삼키고 로깅만 한다.
 */
export async function syncEmbeddingsSafe(
  source: EmbeddingSource,
  sourceId: string,
  userId?: string
): Promise<void> {
  try {
    await syncEmbeddings(source, sourceId, userId)
  } catch (err) {
    console.error(`[embeddings] 동기화 실패 ${source}:${sourceId}`, err)
  }
}

/** deleteEmbeddings 안전 래퍼 */
export async function deleteEmbeddingsSafe(
  source: EmbeddingSource,
  sourceId: string
): Promise<void> {
  try {
    await deleteEmbeddings(source, sourceId)
  } catch (err) {
    console.error(`[embeddings] 삭제 실패 ${source}:${sourceId}`, err)
  }
}

// ─── 검색 ────────────────────────────────────────────────

export interface RetrievedChunk {
  id: string
  source: EmbeddingSource
  sourceId: string
  chunkIndex: number
  title: string
  content: string
  /** 코사인 유사도 (0~1, 높을수록 유사) */
  similarity: number
}

export interface RetrieveOptions {
  /** 반환할 최대 청크 수 (기본 8) */
  limit?: number
  /** 검색 대상 소스 (기본: 전체) */
  sources?: EmbeddingSource[]
  /** 이 유사도 미만 결과는 제외 (기본 0) */
  minSimilarity?: number
  /** Gemini 사용량 기록에 연결할 사용자 */
  userId?: string
}

/**
 * 질의 텍스트와 가장 유사한 임베딩 청크를 벡터 검색으로 반환한다.
 * RAG의 retrieval 단계 — 결과를 LLM 프롬프트 컨텍스트로 사용한다.
 */
export async function retrieveContext(
  query: string,
  opts: RetrieveOptions = {}
): Promise<RetrievedChunk[]> {
  const q = query.trim()
  if (!q) return []

  const limit = opts.limit ?? 8
  const sources = opts.sources?.length ? opts.sources : ALL_SOURCES
  const minSimilarity = opts.minSimilarity ?? 0

  const [queryVec] = await embedTexts([q], "RETRIEVAL_QUERY", opts.userId)
  const vec = toVectorLiteral(queryVec)

  const rows = await prisma.$queryRaw<RetrievedChunk[]>`
    SELECT
      "id", "source", "sourceId", "chunkIndex", "title", "content",
      1 - ("embedding" <=> ${vec}::vector) AS "similarity"
    FROM "EmbeddingChunk"
    WHERE "embedding" IS NOT NULL
      AND "source" = ANY(${sources}::"EmbeddingSource"[])
    ORDER BY "embedding" <=> ${vec}::vector
    LIMIT ${limit}
  `

  return rows.filter((r) => r.similarity >= minSimilarity)
}
