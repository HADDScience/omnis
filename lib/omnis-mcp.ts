// omnis-hadd — 원격 MCP 서버의 알맹이 (도구·지침·토큰).
//
// hadd-ip 를 넓힌 것이다. 지식재산권 도구는 `lib/ip-mcp.ts` 그대로 두고(설명 한 글자도
// 안 바꿨다 — 그 문장들은 모델이 틀렸던 것을 하나씩 막으며 다듬은 것이다), 그 옆에
// 옴니스 본체(업무·채팅·지식·CRM)를 여는 도구를 붙였다.
//
// 쓰기는 화면과 같은 길로만 간다
//  post_message 는 lib/chat-post 의 postChatMessage, ask_omnis 는 lib/omnis-ask 의 askOmnis —
//  화면(app/api)이 부르는 바로 그 함수다. MCP 전용 지름길을 만들면 알림·재구성·색인
//  중 하나가 빠지고, 그것은 조용히 빠진다.
//
// 권한
//  Omnis 계정이 살아 있으면 누구나 붙는다. 지식재산권 도구만 ip.members 로 한 번 더 건다.
//  Prisma 는 DB 소유자로 붙으므로 이 파일이 곧 권한 경계다.
import { randomBytes } from "crypto"

import { prisma } from "@/lib/db"
import { TASK_STATUS_LABELS, PRIORITY_LABELS } from "@/lib/constants"
import { retrieveContext, sectionToText, syncEmbeddingsSafe, type EmbeddingSource } from "@/lib/embeddings"
import { migrateContent } from "@/lib/omnis-types"
import { askOmnis, buildCrmOverview, SOURCE_LABEL } from "@/lib/omnis-ask"
import { postChatMessage } from "@/lib/chat-post"
import { createNotification } from "@/lib/notifications"
import { getMembership, type IpMembership } from "@/lib/ip-data"
import { persistMentions } from "@/lib/mentions"
import { quoteTotals, QUOTE_STATUS_LABEL } from "@/lib/crm"
import {
  TOOLS as IP_TOOLS,
  INSTRUCTIONS as IP_INSTRUCTIONS,
  runTool as runIpTool,
  sha256,
  type ToolResult,
} from "@/lib/ip-mcp"

export { PROTOCOL_VERSION, randomToken, sha256, type ToolResult } from "@/lib/ip-mcp"
export const SERVER_INFO = { name: "omnis-hadd", version: "2.0.0" }

export interface Caller {
  userId: string
  name: string
  role: "ADMIN" | "MEMBER"
  /** 지식재산권 구성원일 때만. 아니면 IP 도구는 거절된다. */
  ip: IpMembership | null
}

/**
 * 토큰 원문 → 사람.
 *
 * hadd-ip 는 DB 함수(ip.resolve_*_token)가 ip.members 와 조인해 돌려줬다 — 구성원이
 * 아니면 아무것도 안 나왔다. 여기서는 토큰 → Omnis 사용자를 먼저 풀고, 지식재산권
 * 멤버십은 따로 붙인다. 마지막 사용 시각 갱신과 조회를 한 문장(UPDATE … RETURNING)으로
 * 끝내는 것은 그대로다.
 */
export async function resolveCaller(authorization: string | null): Promise<Caller | null> {
  const token = (authorization ?? "").replace(/^Bearer\s+/i, "").trim()
  if (!token) return null
  const hash = sha256(token)

  const rows = token.startsWith("hadd_")
    ? await prisma.$queryRaw<{ user_id: string }[]>`
        UPDATE ip.mcp_tokens SET last_used_at = now()
         WHERE token_hash = ${hash} AND revoked_at IS NULL
         RETURNING user_id`
    : await prisma.$queryRaw<{ user_id: string }[]>`
        UPDATE ip.oauth_tokens SET last_used_at = now()
         WHERE access_hash = ${hash} AND revoked_at IS NULL AND expires_at > now()
         RETURNING user_id`
  if (rows.length === 0) return null

  const user = await prisma.user.findUnique({
    where: { id: rows[0].user_id },
    select: { id: true, name: true, role: true, isActive: true },
  })
  if (!user || !user.isActive) return null

  return { userId: user.id, name: user.name, role: user.role, ip: await getMembership(user.id) }
}

// ─── 지침 ───────────────────────────────────────────────────────────

export const INSTRUCTIONS = [
  "HADD SCIENCE 의 업무 시스템 Omnis 입니다. 업무·채팅·사내 지식·CRM(고객/견적/재고)·지식재산권을 읽고, 채팅에 글을 남기거나 업무를 만들 수 있습니다.",
  "「어떻게 돼가?」 같은 질문은 ask_omnis 가 가장 낫습니다 — 전체 현황과 검색을 합쳐 답합니다. 특정 업무의 원문이 필요하면 get_task.",
  "업무에 지시·보고를 남길 때는 post_message 에 task 를 함께 줍니다. 그러면 화면에서 #슬러그 로 쓴 것과 똑같이 업무 카드가 AI 로 재구성되고 담당자에게 알림이 갑니다.",
  "사람 이름은 list_members 의 정식 이름을 씁니다. 업무는 슬러그·ID·이름 일부 어느 것으로든 찾습니다 — 사용자에게 ID 를 되묻지 않습니다.",
  "",
  IP_INSTRUCTIONS.replace("HADD SCIENCE 지식재산권 기록 서버입니다.", "지식재산권 도구(list_ip·get_ip·add_progress …)는 구성원에게만 열립니다."),
].join("\n")

// ─── 도구 ───────────────────────────────────────────────────────────

const TASK_STATUS = ["TODO", "IN_PROGRESS", "REVIEW", "DONE"] as const

export const OMNIS_TOOLS = [
  {
    name: "ask_omnis",
    description:
      "옴니스 AI 에게 묻는다. 질문에 맞춰 검색·업무·CRM·지식재산권 도구를 스스로 골라 부르고 답한다. 「X 어디까지 됐어」「지연된 업무」「재고 얼마 남았어」처럼 현황을 묻는 질문에 먼저 쓴다. 화면의 「Omnis AI 에게 질문하기」와 같은 것이다.",
    inputSchema: {
      type: "object",
      properties: { question: { type: "string", description: "한국어 질문. 500자 이내." } },
      required: ["question"],
    },
  },
  {
    name: "search_knowledge",
    description:
      "의미 검색. 질문에 가까운 채팅·업무·지식 카드·주간보고·지식재산권 조각을 유사도 순으로 돌려준다. ask_omnis 가 답을 만들기 전에 무엇을 근거로 삼는지 직접 보고 싶을 때, 또는 원문 조각이 필요할 때.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        sources: {
          type: "array",
          items: { type: "string", enum: ["TASK", "CHAT_MESSAGE", "OMNIS_CARD", "WEEKLY_REPORT", "IP_CASE"] },
          description: "생략하면 전부",
        },
        limit: { type: "integer", description: "기본 8, 최대 30" },
      },
      required: ["query"],
    },
  },
  {
    name: "list_tasks",
    description:
      "업무 목록. 상태·담당자·프로젝트·이름으로 거른다. mine=true 면 내가 담당인 것만, overdue=true 면 마감이 지난 미완료만. 결과는 최근 만든 순.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: [...TASK_STATUS], description: "TODO 할 일 · IN_PROGRESS 진행 중 · REVIEW 검토 · DONE 완료" },
        assignee: { type: "string", description: "담당자 이름 (일부도 됨)" },
        project: { type: "string", description: "프로젝트 이름 일부" },
        query: { type: "string", description: "업무 이름·배경에 포함된 말" },
        mine: { type: "boolean" },
        overdue: { type: "boolean" },
        limit: { type: "integer", description: "기본 50, 최대 200" },
      },
    },
  },
  {
    name: "get_task",
    description:
      "업무 하나의 전부 — 상태·담당·마감·배경·기대결과·체크리스트·최근 대화·첨부. 「이 업무 원문이 뭐였지」에 답할 때. task 는 슬러그(#없이)·ID·이름 일부 어느 것이든 된다.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string" },
        messages: { type: "integer", description: "함께 보여줄 최근 메시지 수. 기본 20, 최대 100" },
      },
      required: ["task"],
    },
  },
  {
    name: "post_message",
    description: [
      "회사 채팅에 글을 남긴다. task 를 주면 그 업무 스레드에 붙고, 화면에서 #슬러그 로 쓴 것과 똑같이 처리된다 —",
      "AI 가 대화 전체를 읽어 업무 카드(배경·체크리스트·상태)를 재구성하고, 완료로 보이면 담당자에게 확인을 묻고, 관련자에게 알림이 간다.",
      "그러니 지시·보고·피드백은 task 와 함께 보낸다. 잡담이나 공지는 task 없이.",
      "글은 사용자 본인 이름으로 올라간다. 사용자가 말한 내용을 옮길 뿐 지어내지 않는다.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "올릴 글. #슬러그 를 직접 적어도 된다." },
        task: { type: "string", description: "업무 슬러그·ID·이름 일부. 생략하면 스레드 없이 전체 채팅에." },
      },
      required: ["content"],
    },
  },
  {
    name: "create_task",
    description: [
      "새 업무를 만든다. 지시자는 사용자 본인, 담당자는 1명 이상 필수(정식 이름 — list_members 로 확인).",
      "같은 일이 이미 있는지 list_tasks 로 먼저 본다. 프로젝트는 있는 것에만 붙인다(list_projects) — 없으면 비워 두면 '기타' 가 아니라 프로젝트 없음이다.",
      "마감은 대화에 명시된 날짜만 넣는다. 지어낸 마감은 화면에 잘못된 '지연' 으로 뜬다.",
      "만들면 담당자에게 수락 알림이 가고 채팅에 지시 원문과 카드가 올라간다.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "20자 안팎의 명사구. 예: CHAMP+ 2차면접 발표자료 준비" },
        assignees: { type: "array", items: { type: "string" }, description: "담당자 정식 이름들" },
        instruction: { type: "string", description: "사용자가 한 지시 원문. 채팅에 그대로 올라간다." },
        background: { type: "string" },
        checklist: { type: "array", items: { type: "string" }, description: "2~5개. 대화에서 실제 요구된 행동만" },
        deadline: { type: "string", description: "YYYY-MM-DD (KST). 명시된 경우만" },
        priority: { type: "string", enum: ["LOW", "NORMAL", "HIGH"] },
        project: { type: "string", description: "기존 프로젝트 이름 (일부도 됨)" },
      },
      required: ["name", "assignees"],
    },
  },
  {
    name: "list_projects",
    description: "프로젝트(과제) 목록과 각각의 업무 수. 이 회사에서 프로젝트는 정부과제·행사·교육프로그램 단위다.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" }, includeArchived: { type: "boolean" } },
    },
  },
  {
    name: "list_members",
    description: "구성원 이름·직급·부서. 담당자를 지정하거나 「우창」「혜린씨」 같은 호칭을 정식 이름으로 바꿀 때 본다.",
    inputSchema: { type: "object", properties: { includeInactive: { type: "boolean", description: "과거 구성원 포함" } } },
  },
  {
    name: "crm_overview",
    description: "CRM 현황 전량 — 원료·완제품 재고, 생산 기록, 배합, 견적 전부, 샘플요청 전부. 계산되는 값이라 물을 때마다 센다.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "find_org",
    description: "거래 기관 찾기. 이름·코드 일부로 찾아 담당자·견적·샘플요청·출고 이력을 돌려준다.",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "list_omnis_cards",
    description: "사내 지식 카드(옴니스) 목록. 분류·제목·태그로 거른다. 본문은 get_omnis_card.",
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
  },
  {
    name: "get_omnis_card",
    description: "지식 카드 본문 전부. card 는 ID 또는 제목 일부.",
    inputSchema: { type: "object", properties: { card: { type: "string" } }, required: ["card"] },
  },
] as const

export const TOOLS = [...OMNIS_TOOLS, ...IP_TOOLS]

const IP_TOOL_NAMES = new Set<string>(IP_TOOLS.map((t) => t.name))

// ─── 도우미 ─────────────────────────────────────────────────────────

const kst = (d: Date | null | undefined, withTime = false) =>
  d ? d.toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, withTime ? 16 : 10) : ""
const clampInt = (v: unknown, def: number, max: number) =>
  Math.min(max, Math.max(1, Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : def))
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "")

const TASK_SELECT = {
  id: true, name: true, slug: true, status: true, priority: true, deadline: true, createdAt: true, updatedAt: true,
  project: { select: { name: true } },
  product: { select: { name: true } },
  instructor: { select: { name: true } },
  assignees: { select: { user: { select: { id: true, name: true } } } },
} as const

type TaskRow = {
  id: string; name: string; slug: string; status: string; priority: string; deadline: Date | null; createdAt: Date; updatedAt: Date
  project: { name: string } | null; product: { name: string } | null; instructor: { name: string }
  assignees: { user: { id: string; name: string } }[]
}

const isOverdue = (t: { status: string; deadline: Date | null }) =>
  t.status !== "DONE" && !!t.deadline && t.deadline.getTime() < Date.now()

function taskLine(t: TaskRow): string {
  const bits = [
    `#${t.slug}`, t.name, TASK_STATUS_LABELS[t.status] ?? t.status,
    `담당 ${t.assignees.map((a) => a.user.name).join(",") || "미배정"}`,
  ]
  if (t.deadline) bits.push(`마감 ${kst(t.deadline)}${isOverdue(t) ? " (지연)" : ""}`)
  if (t.project) bits.push(t.project.name)
  if (t.priority === "HIGH") bits.push("중요")
  return `- ${bits.join(" · ")}`
}

/**
 * 업무 찾기 — ID → 슬러그 → 이름 일부(최근 것 우선).
 * 이름으로 여럿이 걸리고 정확히 같은 이름이 없으면 고르지 않고 후보를 돌려준다.
 */
async function findTask(ref: string): Promise<{ id: string } | { error: string }> {
  const key = ref.replace(/^#/, "").trim()
  if (!key) return { error: "task 가 비어 있습니다." }
  const direct = await prisma.task.findFirst({
    where: { OR: [{ id: key }, { slug: key }], archived: false },
    select: { id: true },
  })
  if (direct) return direct
  const hits = await prisma.task.findMany({
    where: { archived: false, name: { contains: key, mode: "insensitive" } },
    select: { id: true, name: true, slug: true, status: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 10,
  })
  if (hits.length === 0) return { error: `'${key}' 에 맞는 업무가 없습니다. list_tasks 로 찾아보세요.` }
  const exact = hits.find((h) => h.name === key)
  if (hits.length === 1 || exact) return { id: (exact ?? hits[0]).id }
  return {
    error: [
      `'${key}' 에 맞는 업무가 ${hits.length}개입니다. 슬러그로 다시 부르세요.`,
      ...hits.map((h) => `- #${h.slug} · ${h.name} · ${TASK_STATUS_LABELS[h.status] ?? h.status} · ${kst(h.createdAt)}`),
    ].join("\n"),
  }
}

/** 이름 → 사용자. 정확히 같은 이름 우선, 없으면 「우창님」「혜린씨」 같은 호칭을 벗긴 부분 일치. */
async function findUsers(names: string[]): Promise<{ ids: string[]; missing: string[] }> {
  const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true } })
  const ids: string[] = []
  const missing: string[] = []
  for (const raw of names) {
    const n = raw.trim().replace(/(님|씨|박사님|대표님|과장님|상무님)$/g, "")
    const hit = users.find((u) => u.name === raw.trim()) ?? users.find((u) => u.name === n) ?? users.find((u) => u.name.includes(n) && n.length >= 2)
    if (hit) { if (!ids.includes(hit.id)) ids.push(hit.id) } else missing.push(raw)
  }
  return { ids, missing }
}

// ─── 실행 ───────────────────────────────────────────────────────────

export async function runTool(name: string, args: Record<string, unknown>, caller: Caller): Promise<ToolResult> {
  if (IP_TOOL_NAMES.has(name)) {
    if (!caller.ip) {
      return { error: "지식재산권 도구는 구성원에게만 열립니다. 이 계정은 지식재산권 구성원이 아닙니다 — 담당자에게 권한을 요청하세요." }
    }
    return runIpTool(name, args, {
      userId: caller.ip.userId, email: caller.ip.email, displayName: caller.ip.displayName, role: caller.ip.role,
    })
  }

  switch (name) {
    case "ask_omnis": {
      const question = str(args.question)
      if (question.length < 2) return { error: "질문을 2자 이상 주세요." }
      if (question.length > 500) return { error: "질문이 너무 깁니다 (500자 이내)." }
      const r = await askOmnis(question, caller.userId)
      const src = r.sources.map((s, i) => `[${i + 1}] ${s.sourceLabel} · ${s.title} (${s.similarity}%)`)
      return { text: [r.answer, "", "근거:", ...src].join("\n") }
    }

    case "search_knowledge": {
      const query = str(args.query)
      if (!query) return { error: "query 가 비어 있습니다." }
      const sources = Array.isArray(args.sources)
        ? (args.sources.filter((s): s is EmbeddingSource => typeof s === "string" && s in SOURCE_LABEL))
        : undefined
      const chunks = await retrieveContext(query, { limit: clampInt(args.limit, 8, 30), sources, minSimilarity: 0.25, userId: caller.userId })
      if (chunks.length === 0) return { text: "비슷한 조각이 없습니다." }
      return {
        text: chunks
          .map((c, i) => `[${i + 1}] ${SOURCE_LABEL[c.source]} · ${c.title} (${Math.round(c.similarity * 100)}%)\n${c.content.slice(0, 600)}`)
          .join("\n\n"),
      }
    }

    case "list_tasks": {
      const where: Record<string, unknown> = { archived: false }
      const status = str(args.status)
      if (status && (TASK_STATUS as readonly string[]).includes(status)) where.status = status
      if (args.mine === true) where.assignees = { some: { userId: caller.userId } }
      else if (str(args.assignee)) where.assignees = { some: { user: { name: { contains: str(args.assignee) } } } }
      if (str(args.project)) where.project = { name: { contains: str(args.project), mode: "insensitive" } }
      if (str(args.query)) {
        where.OR = [
          { name: { contains: str(args.query), mode: "insensitive" } },
          { background: { contains: str(args.query), mode: "insensitive" } },
        ]
      }
      if (args.overdue === true) { where.status = { not: "DONE" }; where.deadline = { lt: new Date() } }
      const limit = clampInt(args.limit, 50, 200)
      const [rows, total] = await Promise.all([
        prisma.task.findMany({ where, select: TASK_SELECT, orderBy: { createdAt: "desc" }, take: limit }),
        prisma.task.count({ where }),
      ])
      if (rows.length === 0) return { text: "조건에 맞는 업무가 없습니다." }
      return { text: [`업무 ${total}건${total > rows.length ? ` 중 ${rows.length}건` : ""}`, ...rows.map(taskLine)].join("\n") }
    }

    case "get_task": {
      const found = await findTask(str(args.task))
      if ("error" in found) return found
      const t = await prisma.task.findUnique({
        where: { id: found.id },
        select: {
          ...TASK_SELECT, background: true, expectedResult: true, workStart: true, workEnd: true,
          checklists: { select: { name: true, done: true }, orderBy: { createdAt: "asc" } },
          files: { select: { name: true, size: true } },
        },
      })
      if (!t) return { error: "업무가 없습니다." }
      const n = clampInt(args.messages, 20, 100)
      const msgs = await prisma.chatMessage.findMany({
        where: { taskId: t.id, kind: "NORMAL" },
        select: { createdAt: true, content: true, author: { select: { name: true } }, files: { select: { name: true } } },
        orderBy: { createdAt: "desc" }, take: n,
      })
      const lines = [
        `# ${t.name}  (#${t.slug})`,
        `상태 ${TASK_STATUS_LABELS[t.status] ?? t.status} · 우선순위 ${PRIORITY_LABELS[t.priority] ?? t.priority}` +
          (t.deadline ? ` · 마감 ${kst(t.deadline)}${isOverdue(t) ? " (지연)" : ""}` : "") +
          ` · 만든 날 ${kst(t.createdAt)}`,
        `지시 ${t.instructor.name} · 담당 ${t.assignees.map((a) => a.user.name).join(", ") || "미배정"}` +
          (t.project ? ` · 프로젝트 ${t.project.name}` : "") + (t.product ? ` · 제품 ${t.product.name}` : ""),
      ]
      if (t.background) lines.push("", `배경: ${t.background}`)
      if (t.expectedResult) lines.push(`기대결과: ${t.expectedResult}`)
      if (t.checklists.length) lines.push("", "체크리스트:", ...t.checklists.map((c) => `- [${c.done ? "x" : " "}] ${c.name}`))
      if (t.files.length) lines.push("", `첨부 ${t.files.length}: ${t.files.map((f) => f.name).join(", ")}`)
      if (msgs.length) {
        lines.push("", `대화 (최근 ${msgs.length}건, 시간순):`)
        for (const m of msgs.reverse()) {
          lines.push(`[${kst(m.createdAt, true)}] ${m.author.name}: ${m.content}${m.files.length ? ` [첨부: ${m.files.map((f) => f.name).join(", ")}]` : ""}`)
        }
      }
      return { text: lines.join("\n") }
    }

    case "post_message": {
      const content = str(args.content)
      if (!content) return { error: "content 가 비어 있습니다." }
      let taskId: string | undefined
      let slug: string | undefined
      if (str(args.task)) {
        const found = await findTask(str(args.task))
        if ("error" in found) return found
        const t = await prisma.task.findUnique({ where: { id: found.id }, select: { id: true, slug: true } })
        taskId = t?.id; slug = t?.slug
      }
      // #슬러그가 본문에 이미 있으면 그대로, 없으면 앞에 붙인다 — 화면에서 쓰는 것과 같은 모양.
      const body = slug && !/#[a-z0-9가-힣_-]+/i.test(content) ? `#${slug} ${content}` : content
      const { message, taskUpdate } = await postChatMessage({
        user: { id: caller.userId, name: caller.name }, roomId: "default-room", content: body, taskId,
      })
      const out = [`올렸습니다 (${kst(message?.createdAt ?? new Date(), true)} · ${caller.name}).`]
      if (message?.task) out.push(`업무: #${message.task.slug} ${message.task.name}`)
      out.push(taskUpdate ? `업무 처리: ${taskUpdate.summary ?? taskUpdate.statusLabel ?? taskUpdate.action}` : "업무 카드 변경 없음 (정보 공유로 판단)")
      return { text: out.join("\n") }
    }

    case "create_task": {
      const taskName = str(args.name)
      const names = Array.isArray(args.assignees) ? args.assignees.map(String) : []
      if (!taskName) return { error: "name 이 비어 있습니다." }
      if (names.length === 0) return { error: "담당자가 1명 이상 필요합니다. list_members 로 정식 이름을 확인하세요." }
      const { ids: assigneeIds, missing } = await findUsers(names)
      if (missing.length) return { error: `모르는 이름: ${missing.join(", ")}. list_members 로 확인하세요.` }

      let projectId: string | null = null
      if (str(args.project)) {
        const ps = await prisma.project.findMany({
          where: { archived: false, name: { contains: str(args.project), mode: "insensitive" } },
          select: { id: true, name: true }, take: 10,
        })
        if (ps.length === 0) return { error: `'${str(args.project)}' 프로젝트가 없습니다. list_projects 로 확인하세요.` }
        const exact = ps.find((p) => p.name === str(args.project))
        if (ps.length > 1 && !exact) return { error: `프로젝트가 ${ps.length}개 걸립니다: ${ps.map((p) => p.name).join(" / ")}` }
        projectId = (exact ?? ps[0]).id
      }
      const deadline = /^\d{4}-\d{2}-\d{2}$/.test(str(args.deadline)) ? new Date(`${str(args.deadline)}T23:59:59+09:00`) : null
      const priority = ["LOW", "NORMAL", "HIGH"].includes(str(args.priority)) ? (str(args.priority) as "LOW" | "NORMAL" | "HIGH") : "NORMAL"
      const items = Array.isArray(args.checklist) ? args.checklist.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 8) : []
      const base = taskName.toLowerCase().replace(/[^\w\s가-힣]/g, "").replace(/\s+/g, "-").slice(0, 50) || "업무"

      // slug 유니크 충돌은 접미사를 붙여 다시 시도한다 (app/api/tasks 와 같은 처리).
      let task: { id: string; slug: string; name: string } | null = null
      for (let attempt = 0; attempt < 4 && !task; attempt++) {
        const slug = attempt === 0 ? base : `${base}-${randomBytes(3).toString("hex")}`
        try {
          task = await prisma.task.create({
            data: {
              name: taskName.slice(0, 120), slug, instructorId: caller.userId, projectId, priority, deadline,
              background: str(args.background) || null,
              assignees: { create: assigneeIds.map((userId) => ({ userId })) },
              checklists: { create: items.map((n) => ({ name: n })) },
            },
            select: { id: true, slug: true, name: true },
          })
        } catch (e) {
          const code = (e as { code?: string }).code
          if (code !== "P2002" || attempt === 3) throw e
        }
      }
      if (!task) return { error: "업무를 만들지 못했습니다." }

      // 담당자 전원에게 수락 알림 — 화면에서 만든 것과 같다.
      for (const userId of assigneeIds.filter((id) => id !== caller.userId)) {
        await createNotification(userId, "task_assigned", `새 업무: ${task.name}`, `${caller.name}님이 업무를 지시했습니다.`, task.id, "accept_task")
      }
      // 채팅에 지시 원문과 카드를 올린다 — 채팅이 기록의 원본이다.
      const roomId = "default-room"
      await prisma.chatRoom.upsert({ where: { id: roomId }, update: {}, create: { id: roomId, name: "하드사이언스" } })
      const instruction = str(args.instruction) || `${task.name} — 담당 ${names.join(", ")}`
      const raw = await prisma.chatMessage.create({ data: { roomId, authorId: caller.userId, content: instruction, taskId: task.id, kind: "NORMAL" } })
      const card = await prisma.chatMessage.create({ data: { roomId, authorId: caller.userId, content: `__TASK_CREATED__:${task.id}`, taskId: task.id, kind: "TASK_CREATED" } })
      await persistMentions(raw.id, instruction).catch(() => {})
      await persistMentions(card.id, `#${task.slug}`).catch(() => {})
      await syncEmbeddingsSafe("TASK", task.id, caller.userId)

      return { text: `만들었습니다: #${task.slug} ${task.name}\n담당 ${names.join(", ")}${deadline ? ` · 마감 ${kst(deadline)}` : ""}${items.length ? `\n체크리스트 ${items.length}개` : ""}` }
    }

    case "list_projects": {
      const where: Record<string, unknown> = args.includeArchived === true ? {} : { archived: false }
      if (str(args.query)) where.name = { contains: str(args.query), mode: "insensitive" }
      const rows = await prisma.project.findMany({
        where, orderBy: { createdAt: "desc" },
        select: {
          name: true, status: true, purpose: true, deadline: true, archived: true,
          product: { select: { name: true } },
          tasks: { select: { status: true }, where: { archived: false } },
        },
      })
      if (rows.length === 0) return { text: "프로젝트가 없습니다." }
      return {
        text: [`프로젝트 ${rows.length}개`, ...rows.map((p) => {
          const open = p.tasks.filter((t) => t.status !== "DONE").length
          const bits = [p.name, p.status, `업무 ${p.tasks.length} (미완료 ${open})`]
          if (p.product) bits.push(`제품 ${p.product.name}`)
          if (p.deadline) bits.push(`마감 ${kst(p.deadline)}`)
          if (p.purpose) bits.push(p.purpose)
          if (p.archived) bits.push("보관됨")
          return `- ${bits.join(" · ")}`
        })].join("\n"),
      }
    }

    case "list_members": {
      const rows = await prisma.user.findMany({
        where: args.includeInactive === true ? {} : { isActive: true },
        select: { name: true, position: true, department: true, role: true, isActive: true },
        orderBy: { name: "asc" },
      })
      return {
        text: rows.map((u) => `- ${u.name}${u.position ? ` · ${u.position}` : ""}${u.department ? ` · ${u.department}` : ""}${u.role === "ADMIN" ? " · 관리자" : ""}${u.isActive ? "" : " · 과거 구성원"}`).join("\n"),
      }
    }

    case "crm_overview": {
      const text = await buildCrmOverview()
      return { text: text || "CRM 자료가 없습니다." }
    }

    case "find_org": {
      const q = str(args.query)
      if (!q) return { error: "query 가 비어 있습니다." }
      const orgs = await prisma.crmOrg.findMany({
        where: { OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }] },
        include: {
          contacts: true,
          quotes: { include: { items: { include: { product: true } } }, orderBy: { quotedAt: "desc" } },
          sampleRequests: { include: { product: true }, orderBy: { requestedAt: "desc" } },
          shipments: { include: { product: true }, orderBy: { shippedAt: "desc" }, take: 10 },
        },
        take: 5,
      })
      if (orgs.length === 0) return { text: `'${q}' 에 맞는 기관이 없습니다.` }
      const out: string[] = []
      for (const o of orgs) {
        out.push(`# ${o.name} (${o.code} · ${o.type})${o.address ? ` · ${o.address}` : ""}${o.note ? `\n${o.note}` : ""}`)
        if (o.contacts.length) out.push("담당자:", ...o.contacts.map((c) => `- ${c.name}${c.title ? ` ${c.title}` : ""}${c.email ? ` · ${c.email}` : ""}${c.phone ? ` · ${c.phone}` : ""}`))
        if (o.quotes.length) {
          out.push(`견적 ${o.quotes.length}건:`, ...o.quotes.map((qt) => {
            const t = quoteTotals(qt.items, qt.discountAmount, qt.vatRate)
            return `- ${qt.code} ${kst(qt.quotedAt)} · ${qt.items.map((i) => `${i.product.name} ${i.quantity}개`).join(", ")} · ${QUOTE_STATUS_LABEL[qt.status]} · ${t.total.toLocaleString()}원`
          }))
        }
        if (o.sampleRequests.length) out.push(`샘플요청 ${o.sampleRequests.length}건:`, ...o.sampleRequests.map((s) => `- ${s.code} ${kst(s.requestedAt)}${s.product ? ` · ${s.product.name}` : ""} · ${s.status === "SENT" ? "발송완료" : "미발송"}`))
        if (o.shipments.length) out.push(`출고 (최근 ${o.shipments.length}):`, ...o.shipments.map((s) => `- ${s.code} ${kst(s.shippedAt)} · ${s.product.name} ${s.quantity}개 · ${s.kind}`))
        out.push("")
      }
      return { text: out.join("\n").trim() }
    }

    case "list_omnis_cards": {
      const q = str(args.query)
      const rows = await prisma.omnisCard.findMany({
        where: q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { tags: { has: q } }, { category: { name: { contains: q } } }] } : {},
        select: { id: true, title: true, tags: true, updatedAt: true, category: { select: { name: true } } },
        orderBy: [{ category: { sortOrder: "asc" } }, { title: "asc" }], take: 200,
      })
      if (rows.length === 0) return { text: "지식 카드가 없습니다." }
      return { text: rows.map((c) => `- [${c.category.name}] ${c.title}${c.tags.length ? ` (${c.tags.join(", ")})` : ""} · ${kst(c.updatedAt)} · ${c.id}`).join("\n") }
    }

    case "get_omnis_card": {
      const key = str(args.card)
      const card =
        (await prisma.omnisCard.findFirst({ where: { id: key }, include: { category: true } })) ??
        (await prisma.omnisCard.findFirst({ where: { title: { contains: key, mode: "insensitive" } }, include: { category: true }, orderBy: { updatedAt: "desc" } }))
      if (!card) return { error: `'${key}' 에 맞는 카드가 없습니다.` }
      const cc = migrateContent(card.content)
      const body = cc.sections.map((s) => { const t = sectionToText(s).trim(); return t ? `${s.title ? `## ${s.title}\n` : ""}${t}` : "" }).filter(Boolean).join("\n\n")
      return { text: `# [${card.category.name}] ${card.title}\n갱신 ${kst(card.updatedAt)} · v${card.version}${card.tags.length ? ` · ${card.tags.join(", ")}` : ""}\n\n${body || "(본문 없음)"}` }
    }
  }

  return { error: `모르는 도구입니다: ${name}` }
}
