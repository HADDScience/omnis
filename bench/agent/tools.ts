// wk-agent 의 도구 — WeKnora 에이전트 도구 이름 그대로 + Omnis 업무 DB 읽기.
//
//   search_knowledge  bench/wk/search.ts 의 검색기 (기본 R2: 질의 재작성 + pg_trgm 키워드 + 동일 가중 RRF)
//   grep_chunks       정확 부분 문자열 일치 (ILIKE). WeKnora bccb4b1 에선 search_knowledge(mode=keyword) 로 합쳐졌다 —
//                     여기선 지시대로 따로 둔다
//   read_document     원문 전체. WeKnora 는 청크 앞뒤(context=k)·페이지(offset)로 읽는다. 여기 청크는 문서 단위라
//                     업무는 get_task 전체, 채팅은 앞뒤 대화, IP·주간보고는 색인된 청크 전부를 준다
//   list_documents    WeKnora 는 지식베이스 문서 목록. 여기선 업무 목록 필터(집계 문항용) — 마감 범위를 더했다
//   todo_write        계획 메모. 상태만 돌려준다 (부작용 없음)
//   + 기존 Omnis 읽기 도구 (lib/omnis-mcp runTool 그대로) + ip_overview
//
// 쓰기 도구는 이름 허용 목록(READ_TOOLS)에 없는 한 열리지 않는다. bench/tools.ts 의 BENCH_TOOLS 는 제외 목록 방식이라
// update_task · write_omnis_card 같은 쓰기 도구가 들어 있다 — 여기선 그 방식을 쓰지 않는다.
import { prisma } from "@/lib/db"
import type { EmbeddingSource } from "@/lib/embeddings"
import { OMNIS_TOOLS, runTool, type Caller } from "@/lib/omnis-mcp"
import { buildIpOverview, SOURCE_LABEL } from "@/lib/omnis-ask"
import type { GeminiFunctionDeclaration } from "@/lib/ai"
import { TASK_STATUS_LABELS } from "@/lib/constants"
import { wkRetrieve, WK_LEVELS, type WkLevel } from "../wk/search"

/** search_knowledge 가 쓰는 검색기. R-best 는 R2 (2단계 검색 지표). WK_AGENT_SEARCH=r1a|r3 로 바꾼다 */
export const SEARCH_LEVEL: WkLevel = WK_LEVELS.includes(process.env.WK_AGENT_SEARCH as WkLevel) ? (process.env.WK_AGENT_SEARCH as WkLevel) : "r2"
const SEARCH_TOP = 8
/** 발췌 길이 — 프로덕션 askOmnisRoute 의 search_knowledge 와 같다 */
const EXCERPT_CHARS = 1500
const GREP_LIMIT = 20
const GREP_WINDOW = 200
const CHAT_AROUND = 6
const TASK_MESSAGES = 30
const SOURCES = Object.keys(SOURCE_LABEL) as EmbeddingSource[]

/** 기존 Omnis 도구 중 읽기만 하는 것. 쓰기(post_message · update_* · write_* · save_* · delete_* · upload_* · respond_*)는 넣지 않는다 */
const READ_TOOLS = [
  "list_tasks", "get_task", "list_projects", "list_members", "crm_overview", "find_org",
  "list_omnis_cards", "get_omnis_card", "list_weekly_reports", "list_chat", "list_notifications",
  "company_profile", "list_company_records", "list_tax_invoices", "list_staff", "list_market_companies", "get_context",
]

const kst = (d: Date, withTime = false) => d.toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, withTime ? 16 : 10)

export const AGENT_TOOLS: GeminiFunctionDeclaration[] = [
  {
    name: "search_knowledge",
    description:
      "의미 + 키워드 하이브리드 검색. 채팅·업무·지식 카드·주간보고·지식재산권 조각을 관련도 순으로 돌려준다. 결과마다 [번호]·source·sourceId 가 붙는다. " +
      "질문을 고유명사(사람·기관·제품)가 든 완전한 문장으로 쓴다. 결과가 빗나가면 문서에 쓰였을 법한 말로 바꿔 다시 찾는다. 번호·코드·정확한 이름은 grep_chunks 가 낫다.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "찾을 내용. 완전한 문장, 고유명사 포함" },
        sources: { type: "array", items: { type: "string", enum: SOURCES }, description: "생략하면 전부" },
      },
      required: ["query"],
    },
  },
  {
    name: "grep_chunks",
    description: "정확한 부분 문자열이 든 조각을 찾는다 (대소문자 무시). 사건번호·출원번호·제품코드·금액·사람 이름처럼 글자 그대로 일치해야 하는 것에 쓴다. 최근 수정 순 최대 20개.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "찾을 문자열 그대로 (와일드카드 없음)" },
        sources: { type: "array", items: { type: "string", enum: SOURCES }, description: "생략하면 전부" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "read_document",
    description:
      "검색 결과의 원문 전체를 읽는다. TASK 는 업무 전체(상태·담당·마감·배경·체크리스트·업무 대화), CHAT_MESSAGE 는 그 말의 앞뒤 대화, OMNIS_CARD·IP_CASE·WEEKLY_REPORT 는 본문 전부. " +
      "발췌가 잘렸거나 앞뒤 맥락·최종 결정을 확인해야 할 때 쓴다.",
    parameters: {
      type: "object",
      properties: {
        source: { type: "string", enum: SOURCES },
        sourceId: { type: "string", description: "검색·목록 결과에 나온 sourceId" },
      },
      required: ["source", "sourceId"],
    },
  },
  {
    name: "list_documents",
    description:
      "업무 목록을 조건으로 거른다 — 상태·담당자·프로젝트·마감 범위·키워드. 「몇 개」「전부」「아직 안 끝난」 같은 집계 질문에 쓴다. 전체 건수와 각 업무의 sourceId(read_document 용)를 준다.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "array", items: { type: "string", enum: ["TODO", "IN_PROGRESS", "REVIEW", "DONE"] }, description: "TODO 할 일 · IN_PROGRESS 진행 중 · REVIEW 리뷰 · DONE 완료. 생략하면 전부. 「안 끝난」은 TODO·IN_PROGRESS·REVIEW" },
        assignee: { type: "string", description: "담당자 이름 (일부도 됨)" },
        project: { type: "string", description: "프로젝트 이름 일부" },
        keyword: { type: "string", description: "업무 이름·배경에 든 말" },
        deadlineFrom: { type: "string", description: "마감 시작일 YYYY-MM-DD (포함)" },
        deadlineTo: { type: "string", description: "마감 끝일 YYYY-MM-DD (포함)" },
        includeArchived: { type: "boolean", description: "보관된 업무 포함. 기본 false" },
        limit: { type: "integer", description: "기본 50, 최대 200" },
      },
    },
  },
  ...OMNIS_TOOLS.filter((t) => READ_TOOLS.includes(t.name)).map((t) => {
    const schema = t.inputSchema as { type: string; properties?: Record<string, unknown> }
    const hasProps = schema.properties && Object.keys(schema.properties).length > 0
    return { name: t.name, description: t.description, ...(hasProps ? { parameters: schema as Record<string, unknown> } : {}) }
  }),
  { name: "ip_overview", description: "상표·특허 전량 한 줄 요약과 우리 차례로 남은 지식재산권 업무. 상표·특허·출원·등록을 물으면 쓴다." },
  {
    name: "todo_write",
    description:
      "여러 단계가 필요한 질문에서 찾을 것의 계획을 적고 진행 상태를 갱신한다. 검색·확인 단계만 적는다(\"답 정리\" 같은 단계는 적지 않는다). 단계가 하나뿐이면 쓰지 않는다. 부를 때마다 목록 전체를 다시 준다.",
    parameters: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { content: { type: "string" }, status: { type: "string", enum: ["pending", "in_progress", "completed"] } },
            required: ["content", "status"],
          },
        },
      },
      required: ["items"],
    },
  },
]

// ─── 실행 ──────────────────────────────────────────────────────

export interface ToolContext {
  caller: Caller
  /** 근거 번호 — 문서 단위("SOURCE:sourceId") 로 붙인다. 같은 문서는 다른 도구로 다시 나와도 같은 번호 */
  cite: Map<string, { n: number; source: string; sourceId: string; title: string; similarity: number }>
  /** 모델이 본 문서 전부 (번호 없는 업무 목록 포함) — 심판의 gold 적중 */
  seen: Set<string>
  /** 검색 단계 LLM 원가 (flash-lite, USD) */
  extraCostUsd: number
}

function citeNo(ctx: ToolContext, source: string, sourceId: string, title: string, similarity = 0): number {
  const key = `${source}:${sourceId}`
  ctx.seen.add(key)
  const cur = ctx.cite.get(key)
  if (cur) return cur.n
  const n = ctx.cite.size + 1
  ctx.cite.set(key, { n, source, sourceId, title, similarity })
  return n
}

const label = (s: string) => SOURCE_LABEL[s as EmbeddingSource] ?? s
const asSources = (v: unknown): EmbeddingSource[] | undefined => {
  if (!Array.isArray(v)) return undefined
  const out = v.filter((s): s is EmbeddingSource => typeof s === "string" && SOURCES.includes(s as EmbeddingSource))
  return out.length ? out : undefined
}
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "")

async function searchKnowledge(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const query = str(args.query)
  if (!query) return "오류: query 가 비어 있습니다."
  const sources = asSources(args.sources)
  // wkRetrieve 는 소스 필터가 없어 넉넉히 받아 거른다
  const r = await wkRetrieve(SEARCH_LEVEL, query, sources ? 30 : SEARCH_TOP)
  ctx.extraCostUsd += r.stats.costUsd
  const chunks = (sources ? r.chunks.filter((c) => sources.includes(c.source)) : r.chunks).slice(0, SEARCH_TOP)
  if (chunks.length === 0) return "비슷한 조각이 없습니다. 다른 말로 바꾸거나 grep_chunks 로 정확한 문자열을 찾아보세요."
  return chunks
    .map((c) => `[${citeNo(ctx, c.source, c.sourceId, c.title, c.similarity)}] ${label(c.source)} · ${c.source} ${c.sourceId} · ${c.title}\n${c.content.slice(0, EXCERPT_CHARS)}`)
    .join("\n\n")
}

async function grepChunks(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const pattern = str(args.pattern)
  if (pattern.length < 2) return "오류: pattern 은 2자 이상이어야 합니다."
  const sources = asSources(args.sources) ?? SOURCES
  const like = `%${pattern.replace(/[\\%_]/g, (m) => `\\${m}`)}%`
  const rows = await prisma.$queryRawUnsafe<{ source: string; sourceId: string; title: string; content: string }[]>(
    `SELECT "source", "sourceId", "title", "content" FROM "EmbeddingChunk"
     WHERE "source" = ANY($2::"EmbeddingSource"[]) AND ("content" ILIKE $1 OR "title" ILIKE $1)
     ORDER BY "updatedAt" DESC LIMIT ${GREP_LIMIT}`,
    like, sources
  )
  if (rows.length === 0) return `'${pattern}' 이 든 조각이 없습니다.`
  const lower = pattern.toLowerCase()
  return [
    `'${pattern}' 일치 ${rows.length}건${rows.length === GREP_LIMIT ? " (상한 — 더 있을 수 있음)" : ""}`,
    ...rows.map((r) => {
      const at = r.content.toLowerCase().indexOf(lower)
      const from = Math.max(0, at - GREP_WINDOW)
      const snippet = at < 0 ? r.content.slice(0, GREP_WINDOW * 2) : `${from > 0 ? "…" : ""}${r.content.slice(from, at + pattern.length + GREP_WINDOW)}…`
      return `[${citeNo(ctx, r.source, r.sourceId, r.title)}] ${label(r.source)} · ${r.source} ${r.sourceId} · ${r.title}\n${snippet}`
    }),
  ].join("\n\n")
}

async function readChatAround(id: string): Promise<string | null> {
  const head = await prisma.chatMessage.findUnique({
    where: { id },
    select: { roomId: true, taskId: true, createdAt: true, task: { select: { name: true } } },
  })
  if (!head) return null
  const scope = head.taskId ? { taskId: head.taskId } : { roomId: head.roomId }
  const sel = { id: true, content: true, createdAt: true, author: { select: { name: true } } } as const
  const [before, after] = await Promise.all([
    prisma.chatMessage.findMany({ where: { ...scope, createdAt: { lt: head.createdAt }, kind: "NORMAL", deletedAt: null }, orderBy: { createdAt: "desc" }, take: CHAT_AROUND * 2, select: sel }),
    prisma.chatMessage.findMany({ where: { ...scope, createdAt: { gte: head.createdAt }, kind: "NORMAL", deletedAt: null }, orderBy: { createdAt: "asc" }, take: CHAT_AROUND * 2 + 1, select: sel }),
  ])
  // 시스템 표식(__…)은 JS 에서 거른다 (Prisma startsWith "__" 는 LIKE 와일드카드가 된다 — lib/embeddings withFollowUps 주석)
  const keep = (m: { content: string }) => !m.content.startsWith("__")
  const rows = [...before.filter(keep).slice(0, CHAT_AROUND).reverse(), ...after.filter(keep).slice(0, CHAT_AROUND + 1)]
  return [
    head.task ? `업무 「${head.task.name}」 스레드` : "채팅방 대화",
    ...rows.map((m) => `${m.id === id ? "▶ " : ""}[${kst(m.createdAt, true)}] ${m.author.name}: ${m.content.trim()}`),
  ].join("\n")
}

async function readDocument(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const source = str(args.source)
  const sourceId = str(args.sourceId)
  if (!source || !sourceId) return "오류: source 와 sourceId 가 필요합니다."
  let text: string | null = null
  let title = sourceId
  if (source === "TASK") {
    const r = await runTool("get_task", { task: sourceId, messages: TASK_MESSAGES }, ctx.caller)
    if ("error" in r) return `오류: ${r.error}`
    text = r.text
    title = r.text.split("\n")[0].replace(/^# /, "")
  } else if (source === "OMNIS_CARD") {
    const r = await runTool("get_omnis_card", { card: sourceId }, ctx.caller)
    if ("error" in r) return `오류: ${r.error}`
    text = r.text
  } else if (source === "CHAT_MESSAGE") {
    text = await readChatAround(sourceId)
  } else if (source === "IP_CASE" || source === "WEEKLY_REPORT") {
    // 색인 청크가 곧 본문 전체다 (lib/embeddings buildIpCaseChunks · buildWeeklyReportChunks)
    const rows = await prisma.$queryRaw<{ title: string; content: string }[]>`
      SELECT "title", "content" FROM "EmbeddingChunk" WHERE "source" = ${source}::"EmbeddingSource" AND "sourceId" = ${sourceId} ORDER BY "chunkIndex"`
    if (rows.length) { title = rows[0].title; text = rows.map((r) => r.content).join("\n\n") }
  } else {
    return `오류: 모르는 source ${source}`
  }
  if (!text) return `${source} ${sourceId} 를 찾지 못했습니다.`
  return `[${citeNo(ctx, source, sourceId, title)}] ${label(source)} 원문\n${text}`
}

async function listDocuments(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const where: Record<string, unknown> = {}
  if (args.includeArchived !== true) where.archived = false
  const statuses = Array.isArray(args.status) ? args.status.filter((s): s is string => typeof s === "string" && s in TASK_STATUS_LABELS) : []
  if (statuses.length) where.status = { in: statuses }
  if (str(args.assignee)) where.assignees = { some: { user: { name: { contains: str(args.assignee) } } } }
  if (str(args.project)) where.project = { name: { contains: str(args.project), mode: "insensitive" } }
  if (str(args.keyword)) where.OR = [{ name: { contains: str(args.keyword), mode: "insensitive" } }, { background: { contains: str(args.keyword), mode: "insensitive" } }]
  const day = (v: unknown, end: boolean) => (/^\d{4}-\d{2}-\d{2}$/.test(str(v)) ? new Date(`${str(v)}T${end ? "23:59:59" : "00:00:00"}+09:00`) : null)
  const from = day(args.deadlineFrom, false)
  const to = day(args.deadlineTo, true)
  if (from || to) where.deadline = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) }
  const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 200)
  const [rows, total] = await Promise.all([
    prisma.task.findMany({
      where, orderBy: { createdAt: "desc" }, take: limit,
      select: { id: true, name: true, status: true, deadline: true, archived: true, project: { select: { name: true } }, assignees: { select: { user: { select: { name: true } } } } },
    }),
    prisma.task.count({ where }),
  ])
  if (rows.length === 0) return "조건에 맞는 업무가 없습니다."
  return [
    `업무 ${total}건${total > rows.length ? ` 중 ${rows.length}건` : ""}`,
    ...rows.map((t) => {
      ctx.seen.add(`TASK:${t.id}`)
      const bits = [t.name, TASK_STATUS_LABELS[t.status] ?? t.status, `담당 ${t.assignees.map((a) => a.user.name).join(",") || "미배정"}`]
      if (t.deadline) bits.push(`마감 ${kst(t.deadline)}`)
      if (t.project) bits.push(t.project.name)
      if (t.archived) bits.push("보관")
      return `- ${bits.join(" · ")} · sourceId ${t.id}`
    }),
  ].join("\n")
}

function todoWrite(args: Record<string, unknown>): string {
  const items = Array.isArray(args.items) ? (args.items as { content?: unknown; status?: unknown }[]) : []
  if (items.length === 0) return "오류: items 가 비어 있습니다."
  const mark: Record<string, string> = { pending: "☐", in_progress: "▶", completed: "☑" }
  return ["계획 갱신됨:", ...items.map((it, i) => `${i + 1}. ${mark[String(it.status)] ?? "☐"} ${String(it.content ?? "")}`)].join("\n")
}

export async function runAgentTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  switch (name) {
    case "search_knowledge": return searchKnowledge(args, ctx)
    case "grep_chunks": return grepChunks(args, ctx)
    case "read_document": return readDocument(args, ctx)
    case "list_documents": return listDocuments(args, ctx)
    case "todo_write": return todoWrite(args)
    case "ip_overview": return (await buildIpOverview()) || "지식재산권 자료가 없습니다."
  }
  if (!READ_TOOLS.includes(name)) return `오류: 열려 있지 않은 도구입니다: ${name}`
  const r = await runTool(name, args, ctx.caller)
  return "error" in r ? `오류: ${r.error}` : r.text
}
