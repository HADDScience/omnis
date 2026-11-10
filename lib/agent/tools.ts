// 에이전트 도구 — 무엇을 열고(읽기 자동 · 쓰기 확인), 쓰기 제안을 어떤 카드로 보이고, 어떻게 실행하나.
// 서버 전용(prisma). Workflow 단계(lib/agent/steps.ts)에서만 부른다.
//
// 쓰기는 MCP 쓰기 도구와 **같은 함수**(lib/omnis-mcp runTool)를 부른다 — 화면 · MCP · 에이전트가 한 길.
// 옴니스는 요청한 사람의 권한(Caller)으로 움직인다. 지식재산권 도구는 runTool 이 구성원이 아니면 막는다.
//
// 위험 등급(계획서 folding 1번)
//   읽기  — 자동
//   쓰기  — 확인 카드
//   되돌리기 어려운 것(삭제 · 전사방 게시 · 알림 응답 · 지식재산권 기록) — 쓰기와 같은 확인 카드. 카드에 무엇이 따라오는지 적는다
//
// MCP 도구 가운데 열지 않은 것(AGENT_EXCLUDED) — 에이전트가 곧 옴니스라 다시 부를 까닭이 없거나, 셸 클라이언트용이다.
import { prisma } from "@/lib/db"
import { getIpAccess } from "@/lib/ip-data"
import { retrieveHybrid, type EmbeddingSource } from "@/lib/embeddings"
import { buildIpOverview, SOURCE_LABEL, type AskSource } from "@/lib/omnis-ask"
import { TASK_STATUS_LABELS, PRIORITY_LABELS } from "@/lib/constants"
import { migrateContent } from "@/lib/omnis-types"
import { sectionToText } from "@/lib/embeddings"
import type { Caller } from "@/lib/omnis-mcp"
import { format } from "date-fns"
import { ko } from "date-fns/locale"

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
  // 내가 든 단톡방 · 1:1 — MCP 와 같은 함수(lib/chat-feed). 에이전트는 요청한 사람의 옴니스 1:1 방에서만 돌아 답도 그 사람만 본다
  "list_rooms",
  "company_profile", "list_company_records", "list_record_proposals", "list_tax_invoices", "list_staff",
  "list_market_companies", "get_context",
  // 웍스 캘린더 — 캘린더 탭과 같은 함수 · 보기 권한(lib/calendar/agent-tool)
  "list_calendar",
  // 지식재산권 읽기 — 구성원이 아니면 runTool 이 거절한다. read_guide 는 쓰기 전 확인 코드를 준다
  "list_stages", "list_ip", "get_ip", "list_todo", "read_guide",
  // 첨부 읽기 — 화면과 같은 파일 권한(lib/file-access)
  "read_file",
] as const

/** 쓰기 — 확인 카드를 거친다. MCP 와 같은 함수(runTool)로 실행한다. 결과물 도구(문서 초안 · 파일 · 기록 제안)는 lib/agent/outputs.ts */
export const AGENT_WRITE_TOOLS = [
  "create_task", "update_task", "update_checklist", "post_message", "write_omnis_card", "save_company_record",
  // 4단계 — 주간보고 초안. 기존 저장 경로(lib/weekly-report.ts) 그대로
  "write_weekly_report",
  // MCP 와 맞춤(2026-11-10) — 되돌리기 어려운 것이라 카드에 따라오는 일을 적는다
  "respond_notification", "delete_company_record", "decide_record_proposal", "upload_file",
  // 지식재산권 쓰기 — read_guide 확인 코드 규칙은 runTool(lib/ip-mcp guideGate)이 그대로 지킨다
  "add_progress", "correct_ip", "create_ip",
] as const

/**
 * MCP 에만 있는 도구 — 이유와 함께 둔다(시험이 MCP 목록과 맞춰 본다).
 * ask_omnis: 에이전트가 곧 옴니스다 — 같은 AI 를 다시 부른다.
 * create_upload_link: 셸(curl)로 올리는 링크. 앱에서는 입력창에 파일을 붙인다. 링크가 곧 사용자 권한이라 대화 기록에 남기지 않는다.
 */
export const AGENT_EXCLUDED: Record<string, string> = {
  ask_omnis: "에이전트가 곧 옴니스",
  create_upload_link: "셸 클라이언트용 업로드 링크",
}

const IP_WRITE_TOOLS = new Set(["add_progress", "correct_ip", "create_ip"])

export type AgentWriteTool = (typeof AGENT_WRITE_TOOLS)[number]
export const isWriteTool = (name: string): name is AgentWriteTool => (AGENT_WRITE_TOOLS as readonly string[]).includes(name)

/** 에이전트에서는 쓰기 입력 일부를 뺀다 */
const DROP_PROPS: Record<string, string[]> = {
  // draft(Gemini 초안)는 모델이 본문을 직접 쓰니 필요 없다. 제출(submit)은 확인 카드에 「제출」 로 보인다
  write_weekly_report: ["draft"],
}

/** 에이전트에서 설명을 바꾸는 도구 — MCP 설명이 에이전트에서 열지 않은 인자를 말할 때 */
const AGENT_DESCRIPTIONS: Record<string, string> = {
  write_weekly_report:
    "내 주간보고 본문을 초안으로 저장한다. markdown 에 본문 전체(완료 · 진행 · 다음 주 계획 …)를 쓴다 — 먼저 list_weekly_reports · list_tasks(mine=true)로 이번 주 업무를 확인한다. " +
    "초안 카드에 본문이 보이고 사용자가 [저장] 하면 이번 주(report 를 주면 그 주차) 보고서 본문이 바뀐다. submit=true 는 사용자가 제출까지 하라고 분명히 했을 때만.",
}

const WRITE_SUFFIX = " — 쓰기 도구다. 부르면 바로 실행되지 않고 사용자에게 확인 카드가 뜬다. 사용자가 확인한 뒤에만 실행된다."

export async function agentToolSpecs(): Promise<AgentToolSpec[]> {
  const { OMNIS_TOOLS, TOOLS } = await import("@/lib/omnis-mcp")
  const byName = new Map(TOOLS.map((t) => [t.name, t]))
  const specs: AgentToolSpec[] = [
    {
      name: "search_knowledge",
      description: "의미 + 키워드 검색. 질문에 가까운 채팅·업무·지식 카드·주간보고·지식재산권·사진(설명) 조각을 돌려준다. 대화 내용·진행 상황·결정을 물으면 먼저 쓴다.",
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
    if (name === "write_weekly_report") schema.required = ["markdown"]
    // 지식재산권 쓰기는 guide 확인 코드를 그대로 받는다(read_guide 가 준다). 그 밖에는 guide 칸이 없다
    if (!IP_WRITE_TOOLS.has(name)) delete schema.properties?.guide
    const write = isWriteTool(name)
    specs.push({
      name,
      description: write ? `${AGENT_DESCRIPTIONS[name] ?? t.description}${WRITE_SUFFIX}` : t.description,
      schema: { type: "object", properties: schema.properties ?? {}, ...(schema.required?.length ? { required: schema.required } : {}) },
      risk: write ? "write" : "read",
    })
  }
  // 4단계 결과물 — 문서 초안 · 파일 · 기록 제안
  const { OUTPUT_TOOL_SPECS } = await import("./outputs")
  specs.push(...OUTPUT_TOOL_SPECS)
  return specs
}

/** 요청한 사람 = 옴니스가 움직이는 권한 */
export async function callerFor(userId: string): Promise<Caller> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, role: true, isActive: true } })
  if (!user || !user.isActive) throw new Error("사용자를 찾지 못했습니다")
  return { userId: user.id, name: user.name, role: user.role === "ADMIN" ? "ADMIN" : "MEMBER", ip: await getIpAccess(user.id) }
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
  // read_file 의 내려받기 링크(PDF · 워드 등)가 이 주소로 만들어진다
  const r = await runTool(name, args, caller, { base: appBase() })
  if ("error" in r) return { text: `오류: ${r.error}`, sources }
  // 이미지 파일은 MCP 에서는 이미지로 가지만 도구 결과는 글만 받는다 — 화면에서 열어 보라고 적는다
  return { text: "image" in r ? `${r.text}\n\n이미지 파일입니다. 여기서는 그림을 볼 수 없어 이름 · 크기만 알려 줍니다 — 업무 첨부에서 열어 보세요.` : r.text, sources }
}

/** 링크에 쓰는 앱 주소 — 운영은 PUBLIC_URL. 없으면 빈 값(runTool 이 링크 대신 오류를 돌려준다) */
const appBase = () => (process.env.PUBLIC_URL ?? process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "")

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
  /** 초안 카드 — 본문 미리보기(접힘 · 펼치기). copy 가 있으면 [복사] 단추(메일 회신 등) */
  draft?: { body: string; copy?: string }
  /** 확인 단추 글 — 기본 「확인」. 초안은 「저장」, 파일은 「만들기」 */
  confirmLabel?: string
}

const s = (v: unknown) => (typeof v === "string" ? v.trim() : "")
const list = (v: unknown) => (Array.isArray(v) ? v.map(String).map((x) => x.trim()).filter(Boolean) : [])
const kstDate = (d: Date | null | undefined) => (d ? d.toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 10) : "없음")
const clip = (t: string, n = 400) => (t.length > n ? `${t.slice(0, n)}…` : t)

export async function buildPreview(name: string, args: Record<string, unknown>, ctx: { userId: string; roomId: string }): Promise<WritePreview> {
  const { findTask } = await import("@/lib/omnis-mcp")
  const { isOutputTool, buildOutputPreview } = await import("./outputs")
  if (isOutputTool(name)) return buildOutputPreview(name, args, ctx)
  switch (name) {
    case "write_weekly_report": {
      const md = typeof args.markdown === "string" ? args.markdown.trim() : ""
      const reportId = s(args.report)
      const isoWeek = format(new Date(), "yyyy-'W'II", { locale: ko })
      // lib/weekly-report.ts upsertThisWeekReport 와 같은 주차 이름 — 이번 주 보고서가 없으면 저장할 때 만든다
      const report = reportId
        ? await prisma.weeklyReport.findFirst({ where: { id: reportId, ownerId: ctx.userId } })
        : await prisma.weeklyReport.findUnique({ where: { ownerId_isoWeek: { ownerId: ctx.userId, isoWeek } } })
      if (reportId && !report) return { title: "주간보고 초안", target: reportId, changes: [], risk: "", problem: "내 주간보고에서 그 보고서를 찾지 못했습니다" }
      const before = ((report?.content ?? {}) as { markdown?: string }).markdown?.trim() ?? ""
      return {
        title: "주간보고 초안",
        target: report ? `${report.title} · ${report.isoWeek}${report.status ? ` · ${report.status}` : ""}` : `이번 주(${isoWeek}) 주간보고 — 저장하면 새로 만듭니다`,
        changes: before ? [{ label: "지금 본문", before: clip(before, 300), after: "아래 초안으로 바뀝니다" }] : [],
        draft: { body: md, copy: md },
        confirmLabel: args.submit === true ? "저장하고 제출" : "저장",
        risk: args.submit === true
          ? "내 주간보고 본문이 이 초안으로 바뀌고 제출됩니다. 제출한 보고서는 다른 사람이 봅니다."
          : "내 주간보고 본문이 이 초안으로 바뀝니다. 제출하지는 않습니다 — 주간보고 화면에서 고치고 제출합니다.",
        ...(md ? {} : { problem: "본문(markdown)이 비어 있습니다" }),
      }
    }
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
    case "post_message":
      // task 가 없으면 전사방 — MCP 와 같다(runTool post_message)
      if (!s(args.task)) {
        return {
          title: "전사방에 글 올리기",
          target: "전사방(회사 전체 채팅)",
          changes: [
            { label: "글", before: null, after: clip(s(args.content), 1200) },
            ...(list(args.files).length ? [{ label: "첨부 파일 ID", before: null, after: list(args.files).join(", ") }] : []),
          ],
          risk: "회사 전체 채팅에 내 이름으로 글이 올라가 구성원 모두가 봅니다. 올린 뒤에는 화면에서 직접 지워야 합니다.",
          ...(s(args.content) ? {} : { problem: "글이 비어 있습니다" }),
        }
      }
    // fallthrough — 업무방 글
    case "update_task":
    case "update_checklist": {
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
          changes: [
            { label: "글", before: null, after: clip(s(args.content), 1200) },
            ...(list(args.files).length ? [{ label: "첨부 파일 ID", before: null, after: list(args.files).join(", ") }] : []),
          ],
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
        if (args.archived !== undefined) changes.push({ label: "보관", before: "목록에 보임", after: args.archived === true ? "보관(목록에서 사라짐)" : "목록에 보임" })
        return {
          title: "업무 고치기",
          target,
          changes,
          risk: args.archived === true
            ? "업무를 보관합니다. 업무 목록에서 사라지고 검색에서도 빠집니다 — 되돌리려면 보관함에서 꺼내야 합니다."
            : s(args.status) === "DONE"
              ? "업무를 완료로 바꿉니다. 떠 있는 완료 확인 알림이 거둬지고 변경 이력에 남습니다."
              : "업무 카드 값이 바뀌고 변경 이력에 내 이름으로 남습니다. 상태 · 담당이 바뀌면 관련자에게 알림이 갈 수 있습니다.",
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
  const extra = await buildMorePreview(name, args, ctx)
  if (extra) return extra
  return { title: name, target: "", changes: [], risk: "", problem: `열려 있지 않은 쓰기 도구입니다: ${name}` }
}

/** 입력 칸을 카드 줄로 — 주어진 칸만, 정해 둔 순서와 이름으로 */
function argRows(args: Record<string, unknown>, labels: [string, string][]): PreviewChange[] {
  return labels
    .filter(([k]) => args[k] !== undefined && args[k] !== null && String(args[k]).trim() !== "")
    .map(([k, label]) => ({ label, before: null, after: clip(String(args[k]), 600) }))
}

const RESPONSE_LABEL: Record<string, string> = { accept: "업무 수락", confirm_done: "완료 확인", defer: "나중에(아직)" }

/** MCP 와 맞춰 연 쓰기(2026-11-10) — 되돌리기 어려운 것이라 따라오는 일을 카드에 적는다 */
async function buildMorePreview(name: string, args: Record<string, unknown>, ctx: { userId: string }): Promise<WritePreview | null> {
  const { findTask } = await import("@/lib/omnis-mcp")
  switch (name) {
    case "respond_notification": {
      const response = s(args.response)
      // 사용자 본인 알림만 — 남의 알림 ID 는 찾지 못한 것으로 보인다(실행도 runTool 이 본인 것만 받는다)
      let n = s(args.notification)
        ? await prisma.notification.findFirst({ where: { id: s(args.notification), userId: ctx.userId }, select: { title: true, content: true, resolvedAt: true } })
        : null
      if (!n && !s(args.notification) && s(args.task)) {
        const found = await findTask(s(args.task))
        if (!("error" in found)) {
          n = await prisma.notification.findFirst({
            where: { userId: ctx.userId, entityId: found.id, resolvedAt: null, actionType: response === "accept" ? "accept_task" : "confirm_done" },
            orderBy: { createdAt: "desc" }, select: { title: true, content: true, resolvedAt: true },
          })
        }
      }
      return {
        title: `알림에 응답 — ${RESPONSE_LABEL[response] ?? response}`,
        target: n ? `${n.title}${n.content ? ` — ${clip(n.content, 120)}` : ""}` : s(args.notification) || s(args.task) || "(알림 없음)",
        changes: [{ label: "응답", before: "응답 대기", after: RESPONSE_LABEL[response] ?? response }],
        risk: response === "confirm_done"
          ? "업무를 완료로 표시하고 체크리스트를 모두 체크합니다. 지시자에게 알림이 갑니다. 되돌리려면 업무 화면에서 상태를 다시 바꿔야 합니다."
          : response === "accept"
            ? "업무를 수락합니다. 지시자에게 알림이 갑니다."
            : "알림을 응답한 것으로 닫습니다.",
        ...(!RESPONSE_LABEL[response] ? { problem: "response 는 accept · confirm_done · defer 중 하나입니다" }
          : !n ? { problem: "내게 온 응답 대기 알림을 찾지 못했습니다 — list_notifications 로 확인하세요" }
          : n.resolvedAt ? { problem: "이미 응답한 알림입니다" } : {}),
      }
    }
    case "delete_company_record": {
      const r = s(args.record_id) ? await prisma.companyRecord.findUnique({ where: { id: s(args.record_id) } }) : null
      return {
        title: "회사 기록 지우기",
        target: r ? `${r.title}${r.startsOn ? ` · ${r.startsOn.toISOString().slice(0, 10)}` : ""}` : s(args.record_id) || "(id 없음)",
        changes: r ? [{ label: "지울 줄", before: `${r.kind} · ${r.title}${r.organizer ? ` · ${r.organizer}` : ""}`, after: "지움" }] : [],
        risk: "연혁 한 줄을 지웁니다. 되돌릴 수 없습니다 — 다시 넣으려면 새로 적어야 합니다.",
        ...(r ? {} : { problem: "없는 연혁입니다 — list_company_records 로 id 를 확인하세요" }),
      }
    }
    case "decide_record_proposal": {
      const p = s(args.proposal) ? await prisma.recordProposal.findUnique({ where: { id: s(args.proposal) }, select: { title: true, kind: true, status: true } }) : null
      const action = s(args.action)
      const ACTION: Record<string, string> = { accept: "채택", reject: "제외", revert: "되돌리기(만든 연혁을 지움)" }
      return {
        title: `연혁 후보 ${ACTION[action] ?? action}`,
        target: p ? `${p.kind} · ${p.title} (${p.status})` : s(args.proposal) || "(후보 없음)",
        changes: [
          { label: "판단", before: p?.status ?? null, after: ACTION[action] ?? action },
          ...argRows(args, [["title", "제목"], ["occurred_on", "날짜"], ["kind", "종류"], ["grade", "등급"], ["confidential", "대외비"], ["organizer", "주관"]]),
        ],
        risk: action === "accept"
          ? "채택하면 회사 연혁 표에 한 줄이 생겨 지원서 · 과제 서식의 근거로 쓰입니다."
          : action === "revert"
            ? "채택 · 자동 등록으로 만든 연혁을 지웁니다."
            : "후보를 제외합니다. 정확도 집계에 남습니다.",
        ...(!p ? { problem: "없는 후보입니다 — list_record_proposals 로 id 를 확인하세요" } : !ACTION[action] ? { problem: "action 은 accept · reject · revert 중 하나입니다" } : {}),
      }
    }
    case "upload_file": {
      const hasText = typeof args.content === "string"
      const size = hasText ? Buffer.byteLength(String(args.content), "utf8") : Math.floor((s(args.content_base64).length * 3) / 4)
      return {
        title: "파일 올리기",
        target: s(args.name) || "(이름 없음)",
        changes: [
          { label: "파일", before: null, after: `${s(args.name) || "(이름 없음)"} · ${(size / 1024).toFixed(1)}KB` },
          ...(s(args.task) ? [{ label: "업무 첨부", before: null, after: s(args.task) }] : []),
        ],
        ...(hasText ? { draft: { body: String(args.content).slice(0, 4000) } } : {}),
        confirmLabel: "올리기",
        risk: s(args.task)
          ? "회사 NAS 에 저장되고 그 업무의 첨부 목록에 바로 보입니다. 채팅에 붙이려면 이어서 글을 올립니다."
          : "회사 NAS 에 저장됩니다. 채팅에 붙이기 전에는 다른 사람에게 보이지 않습니다.",
        ...(!s(args.name) ? { problem: "파일 이름이 없습니다" } : hasText === (typeof args.content_base64 === "string") ? { problem: "content 와 content_base64 중 하나만 주세요" } : {}),
      }
    }
    case "add_progress":
      return {
        title: "지식재산권 진행 기록 남기기",
        target: `${s(args.entityId) || "(대상 없음)"} · ${s(args.date) || "(날짜 없음)"}`,
        changes: argRows(args, [
          ["event", "사건"], ["status", "상태"], ["stage", "단계(옛 이름)"], ["direction", "방향"], ["counterpart", "상대"], ["nextTurn", "다음 차례"],
          ["dueOn", "기한"], ["appNo", "출원번호"], ["regNo", "등록번호"], ["probability", "등록가능성 %"], ["note", "내용"], ["source", "근거"], ["raw", "원문"],
        ]),
        risk: "진행 기록이 남고 지식재산권 목록의 상태 · 번호 · 날짜가 함께 바뀝니다. 기록은 지울 수 없어 틀리면 정정 기록을 다시 남겨야 합니다.",
        ...(!s(args.entityId) || !s(args.date) ? { problem: "대상(entityId)과 날짜가 필요합니다" } : {}),
      }
    case "correct_ip":
      return {
        title: "지식재산권 값 정정",
        target: s(args.entityId) || "(대상 없음)",
        changes: argRows(args, [["name", "이름"], ["holder", "보유자"], ["appNo", "출원번호"], ["regNo", "등록번호"], ["filedOn", "출원일"], ["registeredOn", "등록일"], ["status", "상태"], ["stage", "단계(옛 이름)"], ["reason", "까닭"]]),
        risk: "「값 정정」 기록 한 줄로 남고 목록 값이 바뀝니다. 이력에 남아 지울 수 없습니다.",
        ...(!s(args.entityId) || !s(args.reason) ? { problem: "대상(entityId)과 까닭(reason)이 필요합니다" } : {}),
      }
    case "create_ip":
      return {
        title: "지식재산권 새로 만들기",
        target: `${s(args.entityKind) === "patent" ? "특허" : "상표"} · ${s(args.name) || "(이름 없음)"}`,
        changes: argRows(args, [["name", "이름"], ["status", "시작 상태"], ["stage", "단계(옛 이름)"], ["note", "비고"]]),
        risk: "지식재산권 목록에 새 건이 생깁니다. 같은 건을 둘로 만들면 합치기 어렵습니다 — 먼저 list_ip 로 확인했는지 보세요.",
        ...(!s(args.name) || !s(args.entityKind) ? { problem: "종류(entityKind)와 이름이 필요합니다" } : {}),
      }
  }
  return null
}

/** 확인된 쓰기를 실행한다 — MCP 와 같은 runTool. 확인 여부는 부르는 쪽(steps.runWriteTool)이 이미 확인했다 */
export async function executeWrite(name: AgentWriteTool, args: Record<string, unknown>, caller: Caller): Promise<{ ok: boolean; text: string }> {
  const { runTool } = await import("@/lib/omnis-mcp")
  const r = await runTool(name, args, caller)
  return "error" in r ? { ok: false, text: r.error } : { ok: true, text: r.text }
}
