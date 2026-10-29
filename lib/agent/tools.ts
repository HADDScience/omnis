// 에이전트 도구 — 무엇을 열고(읽기 자동 · 쓰기 확인), 쓰기 제안을 어떤 카드로 보이고, 어떻게 실행하나.
// 서버 전용(prisma). Workflow 단계(lib/agent/steps.ts)에서만 부른다.
//
// 쓰기는 MCP 쓰기 도구와 **같은 함수**(lib/omnis-mcp runTool)를 부른다 — 화면 · MCP · 에이전트가 한 길.
// 옴니스는 요청한 사람의 권한(Caller)으로 움직인다. 지식재산권 도구는 runTool 이 구성원이 아니면 막는다.
//
// 위험 등급(계획서 folding 1번)
//   읽기  — 자동
//   쓰기  — 확인 카드
//   되돌리기 어려운 것(삭제 · 외부 게시 · 알림 응답 · 지식재산권 기록) — 이번에 열지 않는다
import { prisma } from "@/lib/db"
import { getMembership } from "@/lib/ip-data"
import { retrieveHybrid, type EmbeddingSource } from "@/lib/embeddings"
import { buildIpOverview, SOURCE_LABEL, type AskSource } from "@/lib/omnis-ask"
import { TASK_STATUS_LABELS, PRIORITY_LABELS } from "@/lib/constants"
import { migrateContent } from "@/lib/omnis-types"
import { sectionToText } from "@/lib/embeddings"
import type { Caller } from "@/lib/omnis-mcp"

export type ToolRisk = "read" | "write"

export interface AgentToolSpec {
  name: string
  description: string
  /** JSON Schema (object) */
  schema: Record<string, unknown>
  risk: ToolRisk
}

/** 읽기 — 자동 실행. search_knowledge · ip_overview 는 여기서 직접 처리한다(각주 번호를 실행에 이어 붙여야 해서) */
export const AGENT_READ_TOOLS = [
  "search_knowledge", "ip_overview",
  "list_tasks", "get_task", "list_projects", "list_members", "crm_overview", "find_org",
  "list_omnis_cards", "get_omnis_card", "list_weekly_reports", "list_chat", "list_notifications",
  "company_profile", "list_company_records", "list_record_proposals", "list_tax_invoices", "list_staff",
  "list_market_companies", "get_context",
  // 지식재산권 읽기 — 구성원이 아니면 runTool 이 거절한다
  "list_stages", "list_ip", "get_ip", "list_todo",
] as const

/** 쓰기 1차 — 확인 카드를 거친다 */
export const AGENT_WRITE_TOOLS = [
  "create_task", "update_task", "update_checklist", "post_message", "write_omnis_card", "save_company_record",
] as const

export type AgentWriteTool = (typeof AGENT_WRITE_TOOLS)[number]
export const isWriteTool = (name: string): name is AgentWriteTool => (AGENT_WRITE_TOOLS as readonly string[]).includes(name)

/** 에이전트에서는 쓰기 입력 일부를 뺀다 — 보관(archived)은 목록에서 사라지게 해 되돌리기 번거롭고, 첨부는 이번 범위 밖 */
const DROP_PROPS: Record<string, string[]> = {
  update_task: ["archived"],
  post_message: ["files"],
}

const WRITE_SUFFIX = " — 쓰기 도구다. 부르면 바로 실행되지 않고 사용자에게 확인 카드가 뜬다. 사용자가 확인한 뒤에만 실행된다."

export async function agentToolSpecs(): Promise<AgentToolSpec[]> {
  const { OMNIS_TOOLS, TOOLS } = await import("@/lib/omnis-mcp")
  const byName = new Map(TOOLS.map((t) => [t.name, t]))
  const specs: AgentToolSpec[] = [
    {
      name: "search_knowledge",
      description: "의미 + 키워드 검색. 질문에 가까운 채팅·업무·지식 카드·주간보고·지식재산권 조각을 돌려준다. 대화 내용·진행 상황·결정을 물으면 먼저 쓴다.",
      schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "검색어. 고유명사(사람·기관·제품)를 포함한다" },
          sources: { type: "array", items: { type: "string", enum: ["TASK", "CHAT_MESSAGE", "OMNIS_CARD", "WEEKLY_REPORT", "IP_CASE", "PHOTO"] }, description: "생략하면 전부" },
          limit: { type: "integer", description: "기본 8, 최대 20" },
        },
        required: ["query"],
      },
      risk: "read",
    },
    {
      name: "ip_overview",
      description: "상표·특허 전량 한 줄 요약과 우리 차례로 남은 지식재산권 업무. 상표·특허·출원·등록을 물으면 쓴다.",
      schema: { type: "object", properties: {} },
      risk: "read",
    },
  ]
  for (const name of [...AGENT_READ_TOOLS, ...AGENT_WRITE_TOOLS]) {
    if (name === "search_knowledge" || name === "ip_overview") continue
    const t = byName.get(name) ?? OMNIS_TOOLS.find((x) => x.name === name)
    if (!t) throw new Error(`에이전트 도구 ${name} 가 MCP 도구 목록에 없습니다`)
    const schema = structuredClone(t.inputSchema) as { type: string; properties?: Record<string, unknown>; required?: string[] }
    for (const p of DROP_PROPS[name] ?? []) delete schema.properties?.[p]
    if (name === "post_message") schema.required = [...new Set([...(schema.required ?? []), "task"])]
    // 지식재산권 도구의 guide 확인 코드는 MCP 클라이언트용이다 — 읽기만 열었으니 뺀다
    delete schema.properties?.guide
    const write = isWriteTool(name)
    specs.push({
      name,
      description: write
        ? `${t.description}${name === "post_message" ? " 에이전트에서는 업무방(task)에만 남긴다." : ""}${WRITE_SUFFIX}`
        : t.description,
      schema: { type: "object", properties: schema.properties ?? {}, ...(schema.required?.length ? { required: schema.required } : {}) },
      risk: write ? "write" : "read",
    })
  }
  return specs
}

/** 요청한 사람 = 옴니스가 움직이는 권한 */
export async function callerFor(userId: string): Promise<Caller> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, role: true, isActive: true } })
  if (!user || !user.isActive) throw new Error("사용자를 찾지 못했습니다")
  return { userId: user.id, name: user.name, role: user.role === "ADMIN" ? "ADMIN" : "MEMBER", ip: await getMembership(user.id) }
}

// ─── 읽기 ───────────────────────────────────────────────────────────

export async function runReadTool(
  name: string,
  args: Record<string, unknown>,
  caller: Caller,
  sources: AskSource[]
): Promise<{ text: string; sources: AskSource[] }> {
  if (!(AGENT_READ_TOOLS as readonly string[]).includes(name)) return { text: `오류: 열려 있지 않은 도구입니다: ${name}`, sources }
  if (name === "search_knowledge") {
    const q = typeof args.query === "string" && args.query.trim() ? args.query : ""
    if (!q) return { text: "오류: query 가 비어 있습니다.", sources }
    const kinds = Array.isArray(args.sources)
      ? args.sources.filter((s): s is EmbeddingSource => typeof s === "string" && s in SOURCE_LABEL)
      : undefined
    const limit = Math.min(Math.max(Number(args.limit) || 8, 1), 20)
    const { chunks } = await retrieveHybrid(q, { limit, sources: kinds, userId: caller.userId })
    if (chunks.length === 0) return { text: "비슷한 조각이 없습니다.", sources }
    const next = [...sources]
    const text = chunks
      .map((c) => {
        let n = next.findIndex((s) => s.id === c.id) + 1
        if (n === 0) {
          next.push({ id: c.id, source: c.source, sourceId: c.sourceId, title: c.title, sourceLabel: SOURCE_LABEL[c.source], similarity: Math.round(c.similarity * 100) })
          n = next.length
        }
        return `[${n}] ${SOURCE_LABEL[c.source]} · ${c.title}\n${c.content.slice(0, 1500)}`
      })
      .join("\n\n")
    return { text, sources: next }
  }
  if (name === "ip_overview") {
    if (!caller.ip) return { text: "오류: 지식재산권 도구는 구성원에게만 열립니다.", sources }
    return { text: (await buildIpOverview()) || "지식재산권 자료가 없습니다.", sources }
  }
  const { runTool } = await import("@/lib/omnis-mcp")
  const r = await runTool(name, args, caller)
  return { text: "error" in r ? `오류: ${r.error}` : r.text, sources }
}

// ─── 쓰기 — 확인 카드 ─────────────────────────────────────────────────

export interface PreviewChange {
  label: string
  before: string | null
  after: string
}

export interface WritePreview {
  /** 「새 업무 만들기」 */
  title: string
  /** 무엇에 — 「#slug 업무 이름」 */
  target: string
  changes: PreviewChange[]
  /** 확인하면 무슨 일이 따라오나 · 왜 확인이 필요한가 */
  risk: string
  /** 대상을 못 찾는 등 실행해도 실패할 이유 — 있으면 카드를 막는다 */
  problem?: string
}

const s = (v: unknown) => (typeof v === "string" ? v.trim() : "")
const list = (v: unknown) => (Array.isArray(v) ? v.map(String).map((x) => x.trim()).filter(Boolean) : [])
const kstDate = (d: Date | null | undefined) => (d ? d.toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 10) : "없음")
const clip = (t: string, n = 400) => (t.length > n ? `${t.slice(0, n)}…` : t)

export async function buildPreview(name: string, args: Record<string, unknown>): Promise<WritePreview> {
  const { findTask } = await import("@/lib/omnis-mcp")
  switch (name) {
    case "create_task": {
      const changes: PreviewChange[] = [
        { label: "업무 이름", before: null, after: s(args.name) || "(없음)" },
        { label: "담당", before: null, after: list(args.assignees).join(", ") || "(없음)" },
      ]
      if (s(args.deadline)) changes.push({ label: "마감", before: null, after: s(args.deadline) })
      if (s(args.priority)) changes.push({ label: "우선순위", before: null, after: PRIORITY_LABELS[s(args.priority)] ?? s(args.priority) })
      if (s(args.project)) changes.push({ label: "프로젝트", before: null, after: s(args.project) })
      if (list(args.checklist).length) changes.push({ label: "체크리스트", before: null, after: list(args.checklist).map((c) => `· ${c}`).join("\n") })
      if (s(args.instruction)) changes.push({ label: "지시 원문", before: null, after: clip(s(args.instruction)) })
      return {
        title: "새 업무 만들기",
        target: s(args.name) || "(이름 없음)",
        changes,
        risk: "업무가 생기고 담당자에게 수락 알림이 갑니다. 전사방에 지시 원문과 업무 카드가 내 이름으로 올라갑니다.",
        ...(list(args.assignees).length === 0 ? { problem: "담당자가 없습니다" } : {}),
      }
    }
    case "update_task":
    case "update_checklist":
    case "post_message": {
      const found = await findTask(s(args.task))
      if ("error" in found) return { title: "업무 고치기", target: s(args.task) || "(업무 없음)", changes: [], risk: "", problem: found.error }
      const t = await prisma.task.findUniqueOrThrow({
        where: { id: found.id },
        include: {
          project: { select: { name: true } },
          assignees: { select: { user: { select: { name: true } } } },
          checklists: { orderBy: { createdAt: "asc" }, select: { name: true, done: true } },
        },
      })
      const target = `#${t.slug} ${t.name}`
      if (name === "post_message") {
        return {
          title: "업무방에 글 남기기",
          target,
          changes: [{ label: "글", before: null, after: clip(s(args.content), 1200) }],
          risk: "업무 스레드에 내 이름으로 글이 올라갑니다. AI 가 이 글로 업무 카드를 다시 정리하고 담당자에게 알림이 갈 수 있습니다.",
        }
      }
      if (name === "update_task") {
        const changes: PreviewChange[] = []
        if (args.status !== undefined) changes.push({ label: "상태", before: TASK_STATUS_LABELS[t.status] ?? t.status, after: TASK_STATUS_LABELS[s(args.status)] ?? s(args.status) })
        if (args.deadline !== undefined) changes.push({ label: "마감", before: kstDate(t.deadline), after: s(args.deadline) || "없음(지움)" })
        if (args.priority !== undefined) changes.push({ label: "우선순위", before: PRIORITY_LABELS[t.priority] ?? t.priority, after: PRIORITY_LABELS[s(args.priority)] ?? s(args.priority) })
        if (args.assignees !== undefined) changes.push({ label: "담당", before: t.assignees.map((a) => a.user.name).join(", ") || "미배정", after: list(args.assignees).join(", ") || "(없음)" })
        if (args.name !== undefined) changes.push({ label: "업무 이름", before: t.name, after: s(args.name) })
        if (args.project !== undefined) changes.push({ label: "프로젝트", before: t.project?.name ?? "없음", after: s(args.project) || "없음(뺌)" })
        if (args.background !== undefined) changes.push({ label: "배경", before: clip(t.background ?? "") || "없음", after: clip(s(args.background)) || "없음" })
        if (args.expected_result !== undefined) changes.push({ label: "기대 결과", before: clip(t.expectedResult ?? "") || "없음", after: clip(s(args.expected_result)) || "없음" })
        return {
          title: "업무 고치기",
          target,
          changes,
          risk: s(args.status) === "DONE"
            ? "업무를 완료로 바꿉니다. 떠 있는 완료 확인 알림이 거둬지고 변경 이력에 남습니다."
            : "업무 카드 값이 바뀌고 변경 이력에 내 이름으로 남습니다.",
          ...(changes.length === 0 ? { problem: "바꿀 칸이 없습니다" } : {}),
        }
      }
      // update_checklist
      const items = t.checklists
      const ref = (r: string) => (/^\d+$/.test(r) ? items[Number(r) - 1]?.name ?? `${r}번(없음)` : r)
      const changes: PreviewChange[] = []
      for (const r of list(args.remove)) changes.push({ label: "지움", before: ref(r), after: "—" })
      for (const a of list(args.add)) changes.push({ label: "추가", before: null, after: a })
      for (const r of list(args.check)) changes.push({ label: "체크", before: `[ ] ${ref(r)}`, after: `[x] ${ref(r)}` })
      for (const r of list(args.uncheck)) changes.push({ label: "체크 풂", before: `[x] ${ref(r)}`, after: `[ ] ${ref(r)}` })
      return {
        title: "체크리스트 고치기",
        target: `${target} · 지금 ${items.filter((c) => c.done).length}/${items.length}`,
        changes,
        risk: "체크리스트가 바뀌고 업무 활동 기록에 남습니다. 모두 체크해도 업무 상태는 바뀌지 않습니다.",
        ...(changes.length === 0 ? { problem: "바꿀 항목이 없습니다" } : {}),
      }
    }
    case "write_omnis_card": {
      const key = s(args.card)
      const existing = key
        ? ((await prisma.omnisCard.findFirst({ where: { id: key }, include: { category: true } })) ??
          (await prisma.omnisCard.findFirst({ where: { title: { contains: key, mode: "insensitive" } }, orderBy: { updatedAt: "desc" }, include: { category: true } })))
        : null
      if (key && !existing) return { title: "지식 카드 고치기", target: key, changes: [], risk: "", problem: `'${key}' 에 맞는 카드가 없습니다` }
      const changes: PreviewChange[] = []
      if (s(args.title)) changes.push({ label: "제목", before: existing?.title ?? null, after: s(args.title) })
      if (s(args.category)) changes.push({ label: "분류", before: existing?.category.name ?? null, after: s(args.category) })
      if (args.markdown !== undefined) {
        const before = existing
          ? migrateContent(existing.content).sections.filter((x) => x.type === "text").map((x) => sectionToText(x)).join("\n").trim()
          : ""
        changes.push({
          label: args.append === true ? "본문 덧붙임" : "본문",
          before: existing ? clip(before) || "(비어 있음)" : null,
          after: clip(String(args.markdown), 1200),
        })
      }
      if (list(args.tags).length) changes.push({ label: "태그", before: existing?.tags.join(", ") || null, after: list(args.tags).join(", ") })
      return {
        title: existing ? "지식 카드 고치기" : "새 지식 카드",
        target: existing ? `[${existing.category.name}] ${existing.title}` : s(args.title) || "(제목 없음)",
        changes,
        risk: "사내 지식 카드는 구성원 모두가 읽고 옴니스가 검색해 답에 씁니다. 버전 기록이 남습니다.",
        ...(!existing && (!s(args.title) || !s(args.category)) ? { problem: "새 카드는 제목과 분류가 필요합니다" } : {}),
      }
    }
    case "save_company_record": {
      const id = s(args.record_id)
      const before = id ? await prisma.companyRecord.findUnique({ where: { id } }) : null
      if (id && !before) return { title: "회사 기록 고치기", target: id, changes: [], risk: "", problem: "없는 연혁입니다" }
      const FIELDS: [string, string, (r: NonNullable<typeof before>) => string | null][] = [
        ["kind", "종류", (r) => r.kind], ["title", "제목", (r) => r.title], ["organizer", "주관 기관", (r) => r.organizer],
        ["starts_on", "시작일", (r) => r.startsOn?.toISOString().slice(0, 10) ?? null], ["ends_on", "종료일", (r) => r.endsOn?.toISOString().slice(0, 10) ?? null],
        ["status", "상태", (r) => r.status], ["venue", "장소", (r) => r.venue], ["prize", "상격", (r) => r.prize],
        ["subject", "과제명", (r) => r.subject], ["grant_no", "과제번호", (r) => r.grantNo],
        ["funding_krw", "지원금(원)", (r) => (r.fundingKrw === null ? null : String(r.fundingKrw))], ["note", "비고", (r) => r.note],
        ["visibility", "공개범위", (r) => r.visibility],
      ]
      const changes = FIELDS.filter(([k]) => args[k] !== undefined).map(([k, label, get]) => ({
        label, before: before ? get(before) ?? "없음" : null, after: clip(String(args[k])),
      }))
      return {
        title: before ? "회사 기록 고치기" : "회사 기록 남기기",
        target: before ? before.title : s(args.title) || "(제목 없음)",
        changes,
        risk: "회사 연혁 · 실적은 지원서 · 과제 서식의 근거로 쓰입니다. INTERNAL 이 아니면 외부 자료에 쓰일 수 있습니다.",
        ...(changes.length === 0 ? { problem: "남길 칸이 없습니다" } : {}),
      }
    }
  }
  return { title: name, target: "", changes: [], risk: "", problem: `열려 있지 않은 쓰기 도구입니다: ${name}` }
}

/** 확인된 쓰기를 실행한다 — MCP 와 같은 runTool. 확인 여부는 부르는 쪽(steps.runWriteTool)이 이미 확인했다 */
export async function executeWrite(name: AgentWriteTool, args: Record<string, unknown>, caller: Caller): Promise<{ ok: boolean; text: string }> {
  const { runTool } = await import("@/lib/omnis-mcp")
  const r = await runTool(name, args, caller)
  return "error" in r ? { ok: false, text: r.error } : { ok: true, text: r.text }
}
