/**
 * 질문 경로(/omnis/ask · MCP ask_omnis)는 쓰기 전 확인이 없으므로 읽기 도구만 연다. 실행: pnpm test:unit
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { ROUTE_READ_TOOLS } from "./omnis-ask"
import { OMNIS_TOOLS } from "./omnis-mcp"

const WRITE_TOOLS = [
  "post_message", "upload_file", "create_upload_link", "respond_notification", "update_task", "update_checklist",
  "create_task", "write_omnis_card", "write_weekly_report", "save_company_record", "delete_company_record",
  "decide_record_proposal", "ask_omnis",
]

test("질문 경로에 쓰기 도구가 없다", () => {
  for (const name of WRITE_TOOLS) assert.equal(ROUTE_READ_TOOLS.has(name), false, name)
})

test("질문 경로의 도구는 모두 MCP 에 있는 이름이다", () => {
  const names = new Set<string>(OMNIS_TOOLS.map((t) => t.name))
  for (const name of ROUTE_READ_TOOLS) assert.ok(names.has(name), name)
})

test("MCP 의 도구는 읽기 목록이나 쓰기 목록 중 하나에 있다 — 새 도구가 생기면 어느 쪽인지 정해야 한다", () => {
  const known = new Set<string>([...ROUTE_READ_TOOLS, ...WRITE_TOOLS, "search_knowledge"])
  for (const t of OMNIS_TOOLS) assert.ok(known.has(t.name), t.name)
})
