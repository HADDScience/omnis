import { createHash } from "crypto"
import { prisma } from "@/lib/db"
import { embedTexts } from "@/lib/ai"
import { migrateContent, type Section } from "@/lib/omnis-types"
import { TASK_STATUS_LABELS } from "@/lib/constants"
import { caseKey, listCases, listProgressFor, parseCaseKey } from "@/lib/ip-data"

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
  | "IP_CASE"

const ALL_SOURCES: EmbeddingSource[] = [
  "OMNIS_CARD",
  "TASK",
  "WEEKLY_REPORT",
  "CHAT_MESSAGE",
  "IP_CASE",
]

/** 채팅 메시지 임베딩 최소 길이 (짧은 잡담 제외) */
const CHAT_MIN_LENGTH = 15

interface RawChunk {
  title: string
  content: string
}

// ─── 텍스트 추출 (소스별 청킹) ───────────────────────────

export function sectionToText(s: Section): string {
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
    include: { author: { select: { name: true } }, task: { select: { name: true } } },
  })
  if (!msg) return null

  const text = msg.content.trim()
  // 시스템 메시지·플레이스홀더·짧은 잡담 제외
  if (msg.kind !== "NORMAL") return null
  if (text.startsWith("__") || text.startsWith("🤖")) return null
  if (text.length < CHAT_MIN_LENGTH) return null

  // 시각을 넣는다. 없으면 "오늘 올렸습니다" 같은 상대 표현을 모델이 질문 시점의 오늘로
  // 읽는다 — 1년 전 이식 대화가 방금 일어난 일로 답변에 섞인 실측이 있다(2026-09-07).
  const when = msg.createdAt.toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 16)
  const lines = [`[채팅 ${when}] ${msg.author.name}: ${text}`]
  if (msg.task?.name) lines.push(`관련 업무: ${msg.task.name}`)
  return [{ title: `${msg.author.name}의 메시지 (${when.slice(0, 10)})`, content: lines.join("\n") }]
}

const TURN_LABEL: Record<string, string> = {
  us: "우리 차례",
  firm: "대리인 차례",
  none: "대기 없음",
}

/**
 * 지식재산권 한 건을 청크 하나로.
 *
 * 대장의 현재 값만 넣지 않고 진행 이력을 함께 싣는다. "이 상표 어떻게 돼가?" 같은
 * 질문의 답은 현재 단계가 아니라 거쳐 온 과정에 있기 때문이다. 한 건이 기록
 * 수십 줄을 넘기는 일이 없어(가장 많은 건도 열 줄 남짓) 통째로 담아도 청크가
 * 비대해지지 않는다.
 *
 * sourceId 는 "trademark:TM-01" 꼴이다 — 상표와 특허의 번호 체계가 달라 번호만으로는
 * 어느 쪽인지 알 수 없다.
 */
async function buildIpCaseChunks(sourceId: string): Promise<RawChunk[] | null> {
  const parsed = parseCaseKey(sourceId)
  if (!parsed) return null

  const found = (await listCases()).find(
    (c) => c.kind === parsed.kind && c.id === parsed.id
  )
  if (!found) return null

  const label = found.kind === "trademark" ? "상표" : "특허"
  const parts: string[] = [`구분: ${label}`, `관리번호: ${found.id}`]

  if (found.nameKo && found.nameKo !== found.name) parts.push(`국문명: ${found.nameKo}`)
  if (found.classes.length > 0) parts.push(`류: ${found.classes.join(", ")}`)
  if (found.goods) parts.push(`지정상품: ${found.goods}`)
  if (found.holder) parts.push(`${found.kind === "trademark" ? "권리자" : "출원인"}: ${found.holder}`)
  parts.push(`현재 단계: ${found.status}`)
  if (found.appNo) parts.push(`출원번호: ${found.appNo}`)
  if (found.regNo) parts.push(`등록번호: ${found.regNo}`)
  if (found.filedOn) parts.push(`출원일: ${found.filedOn}`)
  if (found.registeredOn) parts.push(`등록일: ${found.registeredOn}`)
  if (found.probability !== null) parts.push(`등록 가능성: ${found.probability}%`)
  if (found.note.trim()) parts.push(`비고: ${found.note.trim()}`)

  const history = await listProgressFor(found.kind, found.id)
  if (history.length > 0) {
    const lines = history.map((h) => {
      const bits = [h.date, h.stage]
      if (h.counterpart) bits.push(h.counterpart)
      if (h.nextTurn !== "none") bits.push(TURN_LABEL[h.nextTurn] ?? h.nextTurn)
      if (h.dueOn) bits.push(`기한 ${h.dueOn}`)
      if (h.note.trim()) bits.push(h.note.trim())
      return `- ${bits.join(" · ")}`
    })
    parts.push(`진행 이력 ${history.length}건:\n${lines.join("\n")}`)
  }

  return [
    {
      title: `${found.name} (${label} ${found.id})`,
      content: `[지식재산권] ${found.name}\n${parts.join("\n")}`,
    },
  ]
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
    case "IP_CASE":
      return buildIpCaseChunks(sourceId)
  }
}

/** 지금 DB 에 있는 모든 지식재산권 건의 색인 키. 백필과 정리에 쓴다. */
export async function allIpCaseKeys(): Promise<string[]> {
  return (await listCases()).map((c) => caseKey(c.kind, c.id))
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
 * 여러 엔티티를 한 번에 동기화한다 — 백필·이식용.
 *
 * `syncEmbeddings` 는 엔티티마다 Gemini 를 한 번 부른다. 채팅 수천 건을 그렇게 넣으면
 * 하루 호출 한도(500)를 이식 한 번에 다 쓴다. 여기서는 바뀐 청크만 모아 100건씩
 * 묶어 부르므로 호출 수가 1/100 로 준다. 저장 규칙은 `syncEmbeddings` 와 같다.
 */
export async function syncEmbeddingsBatch(
  source: EmbeddingSource,
  sourceIds: string[],
  opts: { userId?: string; onProgress?: (done: number, total: number) => void } = {}
): Promise<{ embedded: number; unchanged: number; removed: number }> {
  const BATCH = 100
  let embedded = 0, unchanged = 0, removed = 0

  for (let i = 0; i < sourceIds.length; i += BATCH) {
    const ids = sourceIds.slice(i, i + BATCH)
    const existing = await prisma.embeddingChunk.findMany({
      where: { source, sourceId: { in: ids } },
      select: { sourceId: true, chunkIndex: true, contentHash: true },
    })
    const hashOfChunk = new Map(existing.map((e) => [`${e.sourceId}#${e.chunkIndex}`, e.contentHash]))

    const stale: { sourceId: string; index: number; title: string; content: string; hash: string; input: string }[] = []
    for (const sourceId of ids) {
      const raw = await buildChunks(source, sourceId)
      if (!raw || raw.length === 0) {
        const { count } = await prisma.embeddingChunk.deleteMany({ where: { source, sourceId } })
        removed += count
        continue
      }
      raw.forEach((c, index) => {
        const input = `${c.title}\n${c.content}`
        const hash = hashOf(input)
        if (hashOfChunk.get(`${sourceId}#${index}`) === hash) { unchanged++; return }
        stale.push({ sourceId, index, title: c.title, content: c.content, hash, input })
      })
      await prisma.embeddingChunk.deleteMany({ where: { source, sourceId, chunkIndex: { gte: raw.length } } })
    }

    if (stale.length > 0) {
      const vectors = await embedTexts(stale.map((s) => s.input), "RETRIEVAL_DOCUMENT", opts.userId)
      for (let k = 0; k < stale.length; k++) {
        const s = stale[k]
        await prisma.$executeRaw`
          INSERT INTO "EmbeddingChunk"
            ("id", "source", "sourceId", "chunkIndex", "title", "content", "contentHash", "embedding", "createdAt", "updatedAt")
          VALUES
            (gen_random_uuid(), ${source}::"EmbeddingSource", ${s.sourceId}, ${s.index}, ${s.title}, ${s.content}, ${s.hash}, ${toVectorLiteral(vectors[k])}::vector, NOW(), NOW())
          ON CONFLICT ("source", "sourceId", "chunkIndex")
          DO UPDATE SET
            "title" = EXCLUDED."title",
            "content" = EXCLUDED."content",
            "contentHash" = EXCLUDED."contentHash",
            "embedding" = EXCLUDED."embedding",
            "updatedAt" = NOW()
        `
      }
      embedded += stale.length
    }
    opts.onProgress?.(Math.min(i + BATCH, sourceIds.length), sourceIds.length)
  }
  return { embedded, unchanged, removed }
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

// ─── 하이브리드 검색 (벡터 + 키워드, RRF) ──────────────────────────
//
// 벡터만으로는 "케이바이오랩스", "비보젤" 같은 고유명사 질문을 놓친다. 벤치(2026-09-09,
// mydocs/working/2026-09-09-benchmark-round1.md)에서 키워드 일치를 RRF 로 섞으면 같은 모델에서
// 0.1~0.2 점 오르고 비용은 같았다. Neon 에서 BM25 확장(pg_search)이 2026-09-21 에 끝나
// ILIKE 로 센다 — 청크가 수만 건이라 충분히 빠르다.

const KEYWORD_STOP = new Set([
  "어디까지", "진행", "진행됐어", "됐어", "어떻게", "뭐야", "누가", "언제", "어느", "어땠어", "결과", "건은", "건에서",
  "이랑", "그리고", "대해", "대한", "관련", "최근", "올린", "무엇", "뭘", "했고", "했어", "정했어", "있었어", "하기로",
  "알려줘", "알려", "보여줘", "정리해줘", "몇", "전부", "모두",
])
const KEYWORD_PARTICLES = ["이랑", "에서는", "에서", "으로", "은요", "는요", "이야", "이나", "까지", "부터", "에게", "한테", "처럼", "보다", "은", "는", "이", "가", "을", "를", "의", "에", "도", "로", "과", "와", "랑"]

/**
 * 질문에서 검색어를 뽑는다. 형태소 분석 없이 조사만 걷어내는 거친 방식이다.
 * "케이바이오랩스 검수사진이랑" → "케이바이오랩스", "검수사진".
 */
export function extractKeywords(question: string): string[] {
  const raw = question.replace(/[?？!.,·()\[\]"'“”]/g, " ").split(/\s+/).filter(Boolean)
  const out = new Set<string>()
  for (const tok of raw) {
    let t = tok
    for (const p of KEYWORD_PARTICLES) {
      if (t.length > p.length + 1 && t.endsWith(p)) { t = t.slice(0, -p.length); break }
    }
    if (t.length < 2 || KEYWORD_STOP.has(t) || KEYWORD_STOP.has(tok)) continue
    if (/^\d+$/.test(t)) continue
    out.add(t)
  }
  return [...out]
}

interface KeywordRow { id: string; source: EmbeddingSource; sourceId: string; chunkIndex: number; title: string; content: string; hits: number }

/**
 * 벡터 상위 20 + 키워드 상위 20 을 RRF(1/(60+순위))로 합쳐 상위 limit 개.
 * similarity 는 벡터 쪽 값이고, 키워드로만 잡힌 청크는 0 이다.
 */
export async function retrieveHybrid(
  query: string,
  opts: RetrieveOptions = {}
): Promise<{ chunks: RetrievedChunk[]; keywords: string[] }> {
  const q = query.trim()
  if (!q) return { chunks: [], keywords: [] }
  const limit = opts.limit ?? 8
  const sources = opts.sources?.length ? opts.sources : ALL_SOURCES
  const keywords = extractKeywords(q)

  const [vec, kw] = await Promise.all([
    retrieveContext(q, { limit: 20, minSimilarity: 0, sources, userId: opts.userId }),
    keywords.length === 0
      ? Promise.resolve([] as KeywordRow[])
      : prisma.$queryRawUnsafe<KeywordRow[]>(
          `SELECT "id","source","sourceId","chunkIndex","title","content",
                  (${keywords.map((_, i) => `(CASE WHEN "content" ILIKE $${i + 1} OR "title" ILIKE $${i + 1} THEN 1 ELSE 0 END)`).join(" + ")}) AS hits
           FROM "EmbeddingChunk"
           WHERE "source" = ANY($${keywords.length + 1}::"EmbeddingSource"[])
             AND (${keywords.map((_, i) => `"content" ILIKE $${i + 1} OR "title" ILIKE $${i + 1}`).join(" OR ")})
           ORDER BY hits DESC, "updatedAt" DESC
           LIMIT 20`,
          ...keywords.map((k) => `%${k}%`),
          sources
        ),
  ])

  const score = new Map<string, { s: number; row: RetrievedChunk }>()
  const add = (rows: (RetrievedChunk | KeywordRow)[]) =>
    rows.forEach((r, i) => {
      const cur = score.get(r.id)
      const row: RetrievedChunk = cur?.row ?? { ...r, similarity: "similarity" in r ? r.similarity : 0 }
      score.set(r.id, { s: (cur?.s ?? 0) + 1 / (60 + i + 1), row })
    })
  add(vec)
  add(kw)
  const chunks = [...score.values()].sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.row)
  return { chunks, keywords }
}
