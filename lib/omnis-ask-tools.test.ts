/**
 * 질문 경로(/omnis/ask · MCP ask_omnis)는 쓰기 전 확인이 없으므로 읽기 도구만 연다. 실행: pnpm test:unit
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { ROUTE_READ_TOOLS, routeArgsRefusal, routeToolSchema } from "./omnis-ask"
import { OMNIS_TOOLS } from "./omnis-mcp"

const WRITE_TOOLS = [
  "post_message", "upload_file", "create_upload_link", "respond_notification", "update_task", "update_checklist",
  "create_task", "write_omnis_card", "write_weekly_report", "save_company_record", "delete_company_record",
  "decide_record_proposal", "ask_omnis", "record_sample",
  // CRM 고치기 — 질문 경로에는 미리보기로만(ROUTE_PREVIEW_TOOLS) 열린다
  "update_sample", "delete_sample", "create_org", "update_org", "record_stock", "record_production", "update_production", "delete_production",
  "create_quote", "update_quote", "delete_quote", "record_shipment", "record_payment",
  // #248 묶음 1 — 질문 경로에는 미리보기로만
  "create_project", "merge_projects", "manage_room", "manage_notifications", "set_notification_prefs", "delete_weekly_report",
  "update_shipment", "delete_shipment", "delete_stock_move", "delete_payment", "settle_payments",
  "create_contact", "decide_inquiry", "link_tax_invoice", "delete_tax_invoice", "import_tax_invoice",
  "delete_omnis_card", "manage_omnis_category", "restore_omnis_card", "decide_card_proposal", "manage_bookmarks",
  "update_company_profile", "save_company_year", "delete_company_year", "set_calendar_audience", "set_ai_budget", "set_feature_status", "send_feedback",
  "ip_save_communication", "ip_save_action", "ip_progress_edit", "ip_image_edit",
  "save_website_post", "delete_website_post", "arrange_website_posts", "upload_website_media",
  "collect_column_keywords", "column_keyword_action", "create_column_draft", "update_column_draft", "column_draft_action",
  "link_nas_file",
]

test("질문 경로에 쓰기 도구가 없다", () => {
  for (const name of WRITE_TOOLS) assert.equal(ROUTE_READ_TOOLS.has(name), false, name)
})

test("질문 경로의 도구는 모두 MCP 에 있는 이름이다", () => {
  const names = new Set<string>(OMNIS_TOOLS.map((t) => t.name))
  for (const name of ROUTE_READ_TOOLS) assert.ok(names.has(name), name)
})

test("웍스 일정 읽기(list_calendar)는 질문 경로 · 에이전트 읽기 · MCP 에 모두 열린다", async () => {
  const { AGENT_READ_TOOLS, isWriteTool } = await import("./agent/tools")
  assert.ok(ROUTE_READ_TOOLS.has("list_calendar"))
  assert.ok((AGENT_READ_TOOLS as readonly string[]).includes("list_calendar"))
  assert.equal(isWriteTool("list_calendar"), false)
  assert.ok(OMNIS_TOOLS.some((t) => t.name === "list_calendar"))
})

test("MCP 의 도구는 읽기 목록이나 쓰기 목록 중 하나에 있다 — 새 도구가 생기면 어느 쪽인지 정해야 한다", () => {
  // list_rooms — 읽기지만 질문 경로에는 열지 않는다(아래 방 보기 시험)
  // list_room_files — 방 서랍도 같은 까닭으로 질문 경로 밖
  const known = new Set<string>([...ROUTE_READ_TOOLS, ...WRITE_TOOLS, "search_knowledge", "list_rooms", "list_room_files", "list_my_questions", "ai_budget", "list_feature_requests", "ai_survey_results", "list_applications", "ip_records", "list_files"])
  // (list_samples 는 읽기 — ROUTE_READ_TOOLS 에 있다)
  for (const t of OMNIS_TOOLS) assert.ok(known.has(t.name), t.name)
})

test("질문 경로(ask_omnis)는 방 목록 · 방 보기를 열지 않는다 — 근거는 전사방 · 업무 글뿐", () => {
  assert.equal(ROUTE_READ_TOOLS.has("list_rooms"), false)
  const chat = OMNIS_TOOLS.find((t) => t.name === "list_chat")!
  const schema = routeToolSchema("list_chat", chat.inputSchema as never) as { properties: Record<string, { enum?: string[] }> }
  assert.deepEqual(schema.properties.view.enum, ["all", "task", "dm", "ai"])
  for (const p of ["room", "members", "since", "until", "query"]) assert.equal(p in schema.properties, false, p)
  // MCP 쪽 스키마는 그대로 — 사용자가 직접 부르는 길
  assert.ok((chat.inputSchema as unknown as { properties: Record<string, { enum?: string[] }> }).properties.view.enum?.includes("room"))
  assert.ok(routeArgsRefusal("list_chat", { view: "room", room: "x" }))
  assert.equal(routeArgsRefusal("list_chat", { view: "all" }), null)
})

test("방 목록(list_rooms)은 MCP 와 에이전트 읽기에 열리고 쓰기가 아니다", async () => {
  const { AGENT_READ_TOOLS, isWriteTool } = await import("./agent/tools")
  assert.ok((AGENT_READ_TOOLS as readonly string[]).includes("list_rooms"))
  assert.equal(isWriteTool("list_rooms"), false)
  assert.ok(OMNIS_TOOLS.some((t) => t.name === "list_rooms"))
})
