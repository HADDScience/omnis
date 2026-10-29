// 에이전트 벤치의 도구 세트 — 읽기는 실제로, 쓰기는 "제안" 으로만.
//
// 읽기: MCP 서버(lib/omnis-mcp)의 읽기 도구를 그대로 부른다 → 로컬 스냅샷 DB 를 읽는다.
// 쓰기: 제품의 확인 흐름(계획서 2026-10-28 「실행 모델」)과 같은 모양으로, 실행하지 않고 제안으로 적은 뒤
//       모델에게 "제안이 등록되었고 사용자 확인 대기" 를 돌려준다. 제품이 받지 않을 인자(필수 칸 누락,
//       없는 담당자, 없는 분류)는 제품처럼 오류로 돌려주고 rejected 로 남긴다.
//
// 빼는 도구와 이유:
//   ask_omnis           자기 자신(옴니스 AI)을 다시 부른다 — 모델 호출이 숨어 비용이 섞인다
//   upload_file · create_upload_link · read_file   NAS 파일 저장소를 건드린다. 로컬 스냅샷엔 첨부 본문이 없다
//   지식재산권 도구(list_ip …)   구성원 전용. 대신 현황 요약을 ip_overview 로 준다 (1차 벤치와 같다)
import { OMNIS_TOOLS, runTool, type Caller } from "@/lib/omnis-mcp"
import { buildIpOverview } from "@/lib/omnis-ask"
import { KNOWLEDGE_CATEGORY_NAMES } from "@/lib/knowledge-categories"
import { prisma } from "@/lib/db"
import { now } from "../providers"
import type { CallKind, Proposal } from "./types"

export interface ToolSpec {
  name: string
  description: string
  /** JSON Schema (type: object) */
  schema: { type: "object"; properties: Record<string, unknown>; required?: string[] }
}

const READ_NAMES = [
  "search_knowledge", "list_tasks", "get_task", "list_notifications", "list_projects", "list_members",
  "crm_overview", "find_org", "list_omnis_cards", "get_omnis_card", "list_weekly_reports", "list_chat",
  "company_profile", "list_company_records", "list_record_proposals", "list_tax_invoices", "list_staff",
  "list_market_companies", "get_context",
] as const

const WRITE_NAMES = [
  "post_message", "create_task", "update_task", "update_checklist", "respond_notification",
  "write_omnis_card", "write_weekly_report", "save_company_record", "delete_company_record", "decide_record_proposal",
] as const

/** 임베딩을 만드는(= Gemini 를 부르는) 읽기 도구. dry-run 에서는 막는다 */
const PAID_READS = new Set(["search_knowledge"])

const CREATE_FILE: ToolSpec = {
  name: "create_file",
  description: [
    "파일(docx · xlsx · pptx)을 만들어 회사 NAS 첨부로 저장한다. 내용은 구조로 준다 —",
    "xlsx 는 sheets(시트별 columns·rows), docx 는 sections(제목·본문 마크다운), pptx 는 slides(제목·글머리표).",
    "task 를 주면 그 업무 첨부로 들어간다. 숫자·날짜는 도구 결과에 있는 값만 쓴다.",
  ].join(" "),
  schema: {
    type: "object",
    properties: {
      format: { type: "string", enum: ["docx", "xlsx", "pptx"] },
      filename: { type: "string", description: "확장자 포함. 예: 특허현황_261028.xlsx" },
      title: { type: "string", description: "문서 제목" },
      sheets: {
        type: "array",
        description: "xlsx 일 때",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            columns: { type: "array", items: { type: "string" } },
            rows: { type: "array", items: { type: "array", items: { type: "string" } } },
          },
          required: ["name", "columns", "rows"],
        },
      },
      sections: {
        type: "array",
        description: "docx 일 때",
        items: { type: "object", properties: { heading: { type: "string" }, body: { type: "string", description: "마크다운" } }, required: ["heading", "body"] },
      },
      slides: {
        type: "array",
        description: "pptx 일 때",
        items: { type: "object", properties: { title: { type: "string" }, bullets: { type: "array", items: { type: "string" } } }, required: ["title", "bullets"] },
      },
      task: { type: "string", description: "첨부할 업무 슬러그·ID·이름 일부 (선택)" },
    },
    required: ["format", "filename"],
  },
}

const IP_OVERVIEW: ToolSpec = {
  name: "ip_overview",
  description: "상표·특허 전량 한 줄 요약(번호·명칭·상태·출원/등록번호)과 우리 차례로 남은 지식재산권 업무. 상표·특허·출원·등록을 물으면 쓴다.",
  schema: { type: "object", properties: {} },
}

function toSpec(t: (typeof OMNIS_TOOLS)[number]): ToolSpec {
  const s = t.inputSchema as { properties?: Record<string, unknown>; required?: readonly string[] }
  return {
    name: t.name,
    description: t.description,
    schema: { type: "object", properties: { ...(s.properties ?? {}) }, ...(s.required?.length ? { required: [...s.required] } : {}) },
  }
}

export const READ_TOOLS = new Set<string>([...READ_NAMES, "ip_overview"])
export const WRITE_TOOLS = new Set<string>([...WRITE_NAMES, "create_file"])

/** 도구 순서는 고정한다 — 순서가 바뀌면 Anthropic 프롬프트 캐시가 깨진다 */
export const AGENT_TOOLS: ToolSpec[] = [
  ...OMNIS_TOOLS.filter((t) => (READ_NAMES as readonly string[]).includes(t.name)).map(toSpec),
  IP_OVERVIEW,
  ...OMNIS_TOOLS.filter((t) => (WRITE_NAMES as readonly string[]).includes(t.name)).map(toSpec),
  CREATE_FILE,
]

export function agentSystemPrompt(today: string, userName: string): string {
  return `당신은 HADD Science 의 사내 업무 에이전트 "옴니스" 입니다. 오늘은 ${today} 이고, 지금 대화하는 사람은 ${userName} 입니다.
사용자의 요청을 끝까지 처리하세요. 필요한 만큼 도구를 여러 번 불러 사실을 확인하고, 결과물(정리·초안·업무·파일·기록)을 만듭니다.

도구:
- 읽기 도구(list_* · get_* · search_knowledge · crm_overview · find_org · company_profile · ip_overview)는 바로 실행됩니다.
- 쓰기 도구(create_task · update_task · update_checklist · post_message · respond_notification · write_omnis_card · write_weekly_report · save_company_record · delete_company_record · decide_record_proposal · create_file)는 **바로 실행되지 않습니다.**
  부르면 사용자 화면에 확인 카드로 올라가고, 사용자가 [확인] 을 눌러야 실행됩니다. 결과로 "제안이 등록되었고 사용자 확인 대기" 가 돌아옵니다.

일하는 법:
- 사람 이름은 list_members 의 정식 이름으로, 업무는 슬러그(#task-…)로 가리키세요. 같은 일·같은 기록이 이미 있는지 쓰기 전에 확인하세요.
- 마감·날짜·금액·번호는 사용자가 말했거나 도구 결과에 있는 값만 씁니다. 지어내지 않습니다.
- 요청이 모호해 무엇을 바꿔야 할지 정할 수 없으면, 쓰기 도구를 부르지 말고 무엇이 필요한지 되물으세요.
- 개인정보(연락처·생년월일 등)를 여러 사람이 보는 곳에 올리는 일, 되돌리기 어려운 일은 하지 말고 이유를 설명하세요.
- 매출은 확정·잠정·계획을 구분하고, 단계가 다른 숫자를 더하지 마세요.

마지막 답:
- 한국어로 간결하게. 첫 줄에 결론을 쓰세요.
- 쓰기를 제안했다면 "무엇을 제안했고 확인을 기다린다" 고 쓰세요. 실행된 것처럼 "만들었습니다·등록했습니다" 라고 쓰지 않습니다.
- 초안·표는 답에 그대로 보여 주세요.`
}

export interface ExecResult {
  text: string
  isError: boolean
  kind: CallKind
  ms: number
}

export interface ToolContext {
  caller: Caller
  dryRun: boolean
  proposals: Proposal[]
  turn: number
  /** 심판이 볼 도구 결과 (앞부분만) */
  evidence: string[]
}

const RESULT_MAX = 12_000

let memberNames: string[] | null = null
async function activeMemberNames(): Promise<string[]> {
  if (!memberNames) memberNames = (await prisma.user.findMany({ where: { isActive: true }, select: { name: true } })).map((u) => u.name)
  return memberNames
}

const isDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)

/** 제품이 받지 않을 제안이면 이유. 전부 막지는 않는다 — 채점이 인자를 따로 본다 */
async function validateProposal(name: string, args: Record<string, unknown>): Promise<string | null> {
  const spec = AGENT_TOOLS.find((t) => t.name === name)!
  const missing = (spec.schema.required ?? []).filter((k) => args[k] === undefined || args[k] === null || args[k] === "")
  if (missing.length) return `필수 인자가 없습니다: ${missing.join(", ")}`
  if (typeof args.deadline === "string" && args.deadline !== "" && !isDate(args.deadline)) return "deadline 은 YYYY-MM-DD 입니다"
  switch (name) {
    case "create_task": {
      const names = Array.isArray(args.assignees) ? args.assignees.map(String) : []
      if (names.length === 0) return "담당자는 1명 이상이어야 합니다"
      const members = await activeMemberNames()
      const unknown = names.filter((n) => !members.includes(n))
      if (unknown.length) return `구성원이 아닙니다: ${unknown.join(", ")} — list_members 의 정식 이름을 쓰세요`
      return null
    }
    case "write_omnis_card": {
      if (args.card) return null
      if (!args.title || !args.category) return "새 카드는 title 과 category 가 필요합니다"
      if (!KNOWLEDGE_CATEGORY_NAMES.includes(String(args.category))) {
        return `'${String(args.category)}' 분류가 없습니다. 쓸 수 있는 분류: ${KNOWLEDGE_CATEGORY_NAMES.join(" · ")}`
      }
      return null
    }
    case "save_company_record":
      return args.record_id || (args.title && args.kind) ? null : "새 연혁은 title 과 kind 가 필요합니다"
    case "create_file": {
      const f = String(args.format)
      if (f === "xlsx" && !Array.isArray(args.sheets)) return "xlsx 는 sheets 가 필요합니다"
      if (f === "docx" && !Array.isArray(args.sections)) return "docx 는 sections 가 필요합니다"
      if (f === "pptx" && !Array.isArray(args.slides)) return "pptx 는 slides 가 필요합니다"
      return null
    }
    case "post_message":
      return String(args.content ?? "").trim() ? null : "content 가 비어 있습니다"
  }
  return null
}

export async function executeTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ExecResult> {
  const t0 = now()
  const done = (text: string, kind: CallKind, isError = false): ExecResult => {
    const clipped = text.length > RESULT_MAX ? `${text.slice(0, RESULT_MAX)}\n… (${text.length.toLocaleString()}자 중 앞 ${RESULT_MAX.toLocaleString()}자)` : text
    if (kind === "read") ctx.evidence.push(`[${name} ${JSON.stringify(args)}]\n${clipped.slice(0, 3000)}`)
    return { text: clipped, isError, kind, ms: now() - t0 }
  }

  if (WRITE_TOOLS.has(name)) {
    const why = await validateProposal(name, args)
    const seq = ctx.proposals.length + 1
    ctx.proposals.push({ seq, turn: ctx.turn, tool: name, args, ...(why ? { rejected: why } : {}) })
    if (why) return done(`오류: ${why}`, "rejected", true)
    return done(
      `제안 #${seq} 이 등록되었고 사용자 확인 대기 중입니다 (${name}). 아직 실행되지 않았습니다 — 사용자가 확인하면 실행됩니다.`,
      "proposal"
    )
  }
  if (!READ_TOOLS.has(name)) return done(`오류: 이 환경에서 쓸 수 없는 도구입니다: ${name}`, "error", true)
  if (ctx.dryRun && PAID_READS.has(name)) return done(`오류: dry-run 에서는 ${name} 을 막았습니다 (질문 임베딩이 Gemini 를 부른다)`, "blocked", true)

  try {
    if (name === "ip_overview") return done((await buildIpOverview()) || "지식재산권 자료가 없습니다.", "read")
    const r = await runTool(name, args, ctx.caller)
    if ("error" in r) return done(`오류: ${r.error}`, "read", true)
    return done(r.text, "read")
  } catch (err) {
    return done(`오류: ${String(err).slice(0, 300)}`, "error", true)
  }
}
