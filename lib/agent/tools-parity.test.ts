/**
 * 앱 AI(에이전트)가 MCP 로 할 수 있는 일을 다 할 수 있다 — 같은 runTool 을 부르고, 쓰기는 확인 카드를 거친다.
 * 계획: mydocs/plans/2026-11-10-app-ai-mcp-parity.md. 실행: pnpm test:unit
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { TOOLS } from "../omnis-mcp"
import { AGENT_EXCLUDED, AGENT_READ_TOOLS, AGENT_WRITE_TOOLS, agentToolSpecs, isWriteTool } from "./tools"

test("MCP 도구는 모두 에이전트 읽기 · 쓰기에 있거나, 까닭을 적어 뺀 것이다", () => {
  const opened = new Set<string>([...AGENT_READ_TOOLS, ...AGENT_WRITE_TOOLS])
  for (const t of TOOLS) assert.ok(opened.has(t.name) || t.name in AGENT_EXCLUDED, `${t.name} 가 에이전트에 없다`)
  for (const name of Object.keys(AGENT_EXCLUDED)) assert.ok(TOOLS.some((t) => t.name === name), `${name} 는 MCP 에 없는 이름`)
})

test("되돌리기 어려운 쓰기는 확인 카드(쓰기)로 열린다", () => {
  for (const name of ["delete_company_record", "respond_notification", "decide_record_proposal", "add_progress", "correct_ip", "create_ip", "update_task", "post_message", "upload_file"]) {
    assert.equal(isWriteTool(name), true, name)
    assert.equal((AGENT_READ_TOOLS as readonly string[]).includes(name), false, name)
  }
})

test("읽기 · 쓰기 목록이 겹치지 않는다", () => {
  for (const name of AGENT_READ_TOOLS) assert.equal(isWriteTool(name), false, name)
})

test("지식재산권 쓰기는 guide 확인 코드를 받고, 나머지는 guide 칸이 없다", async () => {
  const specs = await agentToolSpecs()
  const props = (name: string) => (specs.find((s) => s.name === name)!.schema as { properties: Record<string, unknown>; required?: string[] })
  for (const name of ["add_progress", "correct_ip", "create_ip"]) {
    assert.ok("guide" in props(name).properties, name)
    assert.ok(props(name).required?.includes("guide"), name)
    assert.equal(specs.find((s) => s.name === name)!.risk, "write")
  }
  for (const name of ["list_ip", "get_ip", "read_guide"]) assert.equal("guide" in props(name).properties, false, name)
  assert.equal(specs.find((s) => s.name === "read_guide")!.risk, "read")
})

test("post_message 는 task 없이도(전사방) · 첨부와 함께 부를 수 있다 — MCP 와 같다", async () => {
  const specs = await agentToolSpecs()
  const pm = specs.find((s) => s.name === "post_message")!.schema as { properties: Record<string, unknown>; required?: string[] }
  assert.equal(pm.required?.includes("task") ?? false, false)
  assert.ok("files" in pm.properties)
  const ut = specs.find((s) => s.name === "update_task")!.schema as { properties: Record<string, unknown> }
  assert.ok("archived" in ut.properties)
})

test("기능 요청 도구는 쓰기(확인 카드)다", async () => {
  const specs = await agentToolSpecs()
  const rf = specs.find((s) => s.name === "request_feature")
  assert.ok(rf)
  assert.equal(rf!.risk, "write")
  assert.deepEqual((rf!.schema as { required: string[] }).required, ["title", "detail"])
})

test("도구 이름이 겹치지 않는다", async () => {
  const names = (await agentToolSpecs()).map((s) => s.name)
  assert.equal(new Set(names).size, names.length)
})
