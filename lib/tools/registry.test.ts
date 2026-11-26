/**
 * 도구 레지스트리 — MCP · 앱 AI · 질문 경로의 노출 목록이 레지스트리 한 곳과 어긋나면 실패한다.
 * 계획: mydocs/plans/2026-11-17-tool-registry.md. 실행: pnpm test:unit
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { TOOLS } from "../omnis-mcp"
import {
  AGENT_EXCLUDED,
  AGENT_READ_TOOLS,
  AGENT_WRITE_TOOLS,
  agentToolSpecs,
} from "../agent/tools"
import { OUTPUT_TOOL_SPECS } from "../agent/outputs"
import {
  ROUTE_PREVIEW_TOOLS,
  ROUTE_READ_TOOLS,
  routePreviewSchema,
} from "../omnis-ask"
import {
  AGENT_READ_NAMES,
  AGENT_WRITE_NAMES,
  ASK_PREVIEW_NAMES,
  ASK_READ_NAMES,
  MCP_TOOL_NAMES,
  TOOL_POLICY,
  toolPolicy,
} from "./registry"

const sorted = (xs: Iterable<string>) => [...xs].sort()

test("MCP 서버가 여는 도구 = 레지스트리 mcp: true (양쪽 다)", () => {
  assert.deepEqual(sorted(TOOLS.map((t) => t.name)), sorted(MCP_TOOL_NAMES))
})

test("앱 AI 도구 = 레지스트리 agent: read · write, 위험도도 같다", async () => {
  const specs = await agentToolSpecs()
  assert.deepEqual(
    sorted(specs.map((s) => s.name)),
    sorted([...AGENT_READ_NAMES, ...AGENT_WRITE_NAMES])
  )
  for (const s of specs) assert.equal(s.risk, toolPolicy(s.name)!.agent, s.name)
  // MCP 에 없는 앱 AI 쓰기는 결과물 도구(lib/agent/outputs.ts)로만 정의된다
  assert.deepEqual(
    sorted(OUTPUT_TOOL_SPECS.map((s) => s.name)),
    sorted(AGENT_WRITE_NAMES.filter((n) => !toolPolicy(n)!.mcp))
  )
})

test("질문 경로 도구 = 레지스트리 ask: read · preview", () => {
  assert.deepEqual(
    sorted([...ROUTE_READ_TOOLS, "search_knowledge", "ip_overview"]),
    sorted(ASK_READ_NAMES)
  )
  assert.deepEqual(sorted(ROUTE_PREVIEW_TOOLS), sorted(ASK_PREVIEW_NAMES))
})

test("한쪽에만 여는 도구는 까닭(why)이 있다", () => {
  for (const [name, p] of Object.entries(TOOL_POLICY) as [
    string,
    { mcp: boolean; agent: string | false; ask: string | false; why?: string },
  ][]) {
    const oneSided =
      !p.mcp || !p.agent || (p.agent === "read" && p.ask === false)
    if (oneSided)
      assert.ok(
        p.why && p.why.length > 5,
        `${name} 은 한쪽에만 열리는데 까닭이 없다`
      )
  }
  for (const [name, why] of Object.entries(AGENT_EXCLUDED))
    assert.ok(why, `${name} 의 제외 까닭이 비었다`)
})

test("쓰기는 확인 절차가 있고, 질문 경로에는 미리보기로만 — confirm 으로 확인하는 도구만", () => {
  for (const [name, p] of Object.entries(TOOL_POLICY) as [
    string,
    { agent: string | false; ask: string | false; confirm?: string },
  ][]) {
    if (p.agent === "write")
      assert.ok(p.confirm, `${name} 쓰기에 확인 절차가 없다`)
    if (p.agent === "write")
      assert.notEqual(p.ask, "read", `${name} 쓰기가 질문 경로에 그대로 열렸다`)
    if (p.ask === "preview")
      assert.equal(
        p.confirm,
        "param",
        `${name} 은 confirm 이 없어 미리보기를 못 한다`
      )
  }
  // confirm 으로 확인하는 도구는 MCP 입력에 confirm 이 있다
  for (const t of TOOLS) {
    if (toolPolicy(t.name)?.confirm !== "param") continue
    assert.ok(
      "confirm" in
        ((t.inputSchema as { properties?: Record<string, unknown> })
          .properties ?? {}),
      t.name
    )
  }
})

test("샘플 전달 · 기관 찾기 — 앱 AI 에서 쓰기 · 읽기, 질문 경로에서 미리보기 · 읽기", async () => {
  assert.equal(toolPolicy("record_sample")!.agent, "write")
  assert.equal(toolPolicy("record_sample")!.ask, "preview")
  assert.equal(toolPolicy("find_org")!.agent, "read")
  assert.equal(toolPolicy("find_org")!.ask, "read")
  const specs = await agentToolSpecs()
  assert.ok(specs.some((s) => s.name === "record_sample" && s.risk === "write"))
  assert.ok(specs.some((s) => s.name === "find_org" && s.risk === "read"))
  const mcp = TOOLS.find((t) => t.name === "record_sample")!.inputSchema as {
    type: string
    properties: Record<string, unknown>
  }
  const preview = routePreviewSchema(mcp)
  assert.equal("confirm" in (preview.properties ?? {}), false)
  assert.ok("org" in (preview.properties ?? {}))
  assert.ok("confirm" in mcp.properties, "원래 MCP 스키마는 그대로")
})

// 재설계 전(2026-11-17 main 6896061) 손으로 적던 목록 — 노출이 바뀌지 않았는지(질문 경로의 record_sample 미리보기만 새로 더했다)
const BEFORE_AGENT_READ = [
  "search_knowledge",
  "ip_overview",
  "list_tasks",
  "get_task",
  "list_projects",
  "list_members",
  "crm_overview",
  "find_org",
  "list_omnis_cards",
  "get_omnis_card",
  "list_weekly_reports",
  "list_chat",
  "list_notifications",
  "list_rooms",
  "company_profile",
  "list_company_records",
  "list_record_proposals",
  "list_tax_invoices",
  "list_staff",
  "list_market_companies",
  "get_context",
  "list_calendar",
  "list_stages",
  "list_ip",
  "get_ip",
  "list_todo",
  "read_guide",
  "read_file",
]
const BEFORE_AGENT_WRITE = [
  "create_task",
  "update_task",
  "update_checklist",
  "post_message",
  "write_omnis_card",
  "save_company_record",
  "write_weekly_report",
  "respond_notification",
  "delete_company_record",
  "decide_record_proposal",
  "upload_file",
  "record_sample",
  "add_progress",
  "correct_ip",
  "create_ip",
  "add_ip_image",
]
const BEFORE_ROUTE_READ = [
  "list_tasks",
  "get_task",
  "read_file",
  "list_notifications",
  "list_projects",
  "list_members",
  "crm_overview",
  "find_org",
  "list_omnis_cards",
  "get_omnis_card",
  "list_weekly_reports",
  "list_chat",
  "company_profile",
  "list_company_records",
  "list_record_proposals",
  "list_tax_invoices",
  "list_staff",
  "list_market_companies",
  "get_context",
  "list_calendar",
]

// 재설계 뒤 새로 더한 읽기 도구 — 세 경로 모두에 연다
const ADDED_READ = [
  "list_products",
  "list_samples",
  "list_quotes",
  "list_receivables",
  "list_productions",
  "list_shipments",
]
// 2026-11-18 더한 CRM 고치기 — 앱 AI 쓰기(확인 카드) · 질문 경로 미리보기 · MCP confirm
const ADDED_WRITE = [
  "update_sample",
  "delete_sample",
  "create_org",
  "update_org",
  "record_stock",
  "record_production",
  "create_quote",
  "update_quote",
  "delete_quote",
  "record_shipment",
  "record_payment",
  // 2026-11-25 생산 기록 고치기 · 지우기(젤 타입 재고 구조)
  "update_production",
  "delete_production",
  // 2026-11-25 3차 출고 고치기 · 지우기 — 묶음 2(PW)에서 생산과 같은 계획(재고 전 → 뒤)으로 옮겼다
  "update_shipment",
  "delete_shipment",
]

// #248 묶음 1 — 업무 · 프로젝트 · 채팅 방 · 알림 · 주간보고. 방 서랍은 질문 경로에 열지 않는다(단톡 · 1:1)
const B1_READ = ["list_task_products", "list_activity"]
const B1_READ_NO_ASK = ["list_room_files"]
const B1_WRITE = [
  "create_project",
  "merge_projects",
  "manage_room",
  "manage_notifications",
  "set_notification_prefs",
  "delete_weekly_report",
]
// #248 묶음 3 — 지식 카드. 내 질문 기록은 질문 경로에 열지 않는다
const B3_READ = ["omnis_card_history", "list_card_proposals", "list_bookmarks"]
const B3_READ_NO_ASK = ["list_my_questions"]
const B3_WRITE = [
  "delete_omnis_card",
  "manage_omnis_category",
  "restore_omnis_card",
  "decide_card_proposal",
  "manage_bookmarks",
]
// #248 묶음 4 — 회사 · 캘린더 · 관리 설정. 관리자만 보는 읽기는 질문 경로 밖
// 채용 지원서함(HR 1단계)도 같은 자리 — 채용 담당만 보는 이름이라 질문 경로 밖
const B4_READ_NO_ASK = [
  "ai_budget",
  "list_feature_requests",
  "ai_survey_results",
  "list_applications",
]
const B4_WRITE = [
  "update_company_profile",
  "save_company_year",
  "delete_company_year",
  "set_calendar_audience",
  "set_ai_budget",
  "set_feature_status",
  "send_feedback",
]
// #248 묶음 5 — 지식재산권. 읽기는 질문 경로 밖(ip_overview 한 장)
const B5_READ_NO_ASK = ["ip_records"]
const B5_WRITE = [
  "ip_save_communication",
  "ip_save_action",
  "ip_progress_edit",
  "ip_image_edit",
]
// #248 묶음 6 — 홈페이지 · 칼럼
const B6_READ = [
  "list_website_posts",
  "website_stats",
  "list_column_keywords",
  "list_column_drafts",
]
const B6_WRITE = [
  "save_website_post",
  "delete_website_post",
  "arrange_website_posts",
  "upload_website_media",
  "collect_column_keywords",
  "column_keyword_action",
  "create_column_draft",
  "update_column_draft",
  "column_draft_action",
]
// #248 묶음 7 — 파일 · NAS
const B7_READ = ["browse_nas"]
const B7_READ_NO_ASK = ["list_files"]
const B7_WRITE = ["link_nas_file"]
// 2026-11-25 인증 · 가점 — 세 경로 모두에 연다
const CERT_READ = ["list_certifications"]
// 2026-11-25 국가과제 — 읽기는 세 경로, 쓰기는 앱 AI 확인 카드 · 질문 경로 미리보기 · MCP confirm
const GRANT_READ = ["list_grant_decisions", "search_grant_notices"]
const GRANT_WRITE = [
  "update_certification",
  "update_grant_decision",
  "add_grant_decision",
]
// #248 묶음 2 — CRM 나머지
const B2_READ = ["list_stock_moves", "list_payments", "list_inquiries"]
const B2_WRITE = [
  "delete_stock_move",
  "delete_payment",
  "settle_payments",
  "create_contact",
  "decide_inquiry",
  "link_tax_invoice",
  "delete_tax_invoice",
  "import_tax_invoice",
]

test("재설계 전과 노출이 같다(새 도구만 더함) — 앱 AI 읽기 · 쓰기, 질문 경로 읽기, MCP 전용", () => {
  assert.deepEqual(
    sorted(AGENT_READ_TOOLS),
    sorted([
      ...BEFORE_AGENT_READ,
      ...ADDED_READ,
      ...B1_READ,
      ...B1_READ_NO_ASK,
      ...B2_READ,
      ...B3_READ,
      ...B3_READ_NO_ASK,
      ...B4_READ_NO_ASK,
      ...B5_READ_NO_ASK,
      ...B6_READ,
      ...B7_READ,
      ...B7_READ_NO_ASK,
      ...CERT_READ,
      ...GRANT_READ,
    ])
  )
  assert.deepEqual(
    sorted(AGENT_WRITE_TOOLS),
    sorted([
      ...BEFORE_AGENT_WRITE,
      ...ADDED_WRITE,
      ...B1_WRITE,
      ...B2_WRITE,
      ...B3_WRITE,
      ...B4_WRITE,
      ...B5_WRITE,
      ...B6_WRITE,
      ...B7_WRITE,
      ...GRANT_WRITE,
    ])
  )
  assert.deepEqual(
    sorted(ROUTE_READ_TOOLS),
    sorted([
      ...BEFORE_ROUTE_READ,
      ...ADDED_READ,
      ...B1_READ,
      ...B2_READ,
      ...B3_READ,
      ...B6_READ,
      ...B7_READ,
      ...CERT_READ,
      ...GRANT_READ,
    ])
  )
  assert.deepEqual(sorted(Object.keys(AGENT_EXCLUDED)), [
    "ask_omnis",
    "create_upload_link",
  ])
})

// Gemini 는 enum 에 문자열만 받는다 — 숫자 enum 하나가 질문 경로(ask_omnis) 전체를 400 으로 막았다(website_stats, 2026-11-26)
test("도구 입력 스키마의 enum 은 모두 문자열", () => {
  const bad: string[] = []
  const walk = (tool: string, path: string, node: unknown) => {
    if (!node || typeof node !== "object") return
    const o = node as Record<string, unknown>
    if (Array.isArray(o.enum) && o.enum.some((v) => typeof v !== "string"))
      bad.push(`${tool}${path}`)
    for (const [k, v] of Object.entries(o)) if (k !== "enum") walk(tool, `${path}.${k}`, v)
  }
  for (const t of TOOLS) walk(t.name, "", (t as { inputSchema?: unknown }).inputSchema)
  assert.deepEqual(bad, [])
})
