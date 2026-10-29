/** 옴니스가 쓴 도구 — 실행 대화에서 다시 그리기. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"

import { summarizeInput, summarizeOutput, toolTrail } from "./tool-trail"

const run = [
  { role: "user", content: [{ type: "text", text: "이번 주 마감인 업무" }] },
  { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "list_tasks", input: { limit: 200, status: "" } }] },
  { role: "tool", content: [{ type: "tool-result", toolCallId: "c1", toolName: "list_tasks", output: { type: "text", value: "업무 686건 중 200건\n- #a · 할 일" } }] },
  { role: "assistant", content: [{ type: "tool-call", toolCallId: "c2", toolName: "update_task", input: { task: "판넬 제작", deadline: "2026-11-12" } }, { type: "tool-approval-request", approvalId: "x", toolCallId: "c2" }] },
]

test("부른 순서대로 이름 · 인자 요약 · 결과 요약", () => {
  const t = toolTrail(run)
  assert.equal(t.length, 2)
  assert.deepEqual(t[0], { id: "c1", name: "list_tasks", input: "limit: 200", result: "업무 686건 중 200건 - #a · 할 일", state: "done" })
  assert.equal(t[1].input, "task: 판넬 제작 · deadline: 2026-11-12")
  assert.equal(t[1].state, "approval")
  assert.equal(t[1].result, "확인 카드")
})

test("확인 뒤 이어 간 구간의 결과가 붙으면 그 결과로 — 같은 호출은 한 번", () => {
  const t = toolTrail([...run, { role: "tool", content: [{ type: "tool-result", toolCallId: "c2", toolName: "update_task", output: { type: "text", value: "고쳤습니다" } }] }, ...run.slice(1, 2)])
  assert.equal(t.length, 2)
  assert.equal(t[1].result, "고쳤습니다")
  assert.equal(t[1].state, "done")
})

test("취소 · 오류는 error", () => {
  assert.deepEqual(summarizeOutput({ type: "execution-denied", reason: "사용자가 취소" }), { text: "실행하지 않음", error: true })
  assert.equal(summarizeOutput({ type: "error-text", value: "없는 업무" }).error, true)
})

test("긴 결과 · 긴 인자는 자른다", () => {
  assert.ok(summarizeOutput({ type: "text", value: "가".repeat(500) }).text.length <= 140)
  assert.ok(summarizeInput({ q: "나".repeat(200), x: 1 }).length <= 90)
})

test("글만 있는 대화(앞 턴 기록)에는 도구가 없다", () => {
  assert.deepEqual(toolTrail([{ role: "user", content: "안녕" }, { role: "assistant", content: "안녕하세요" }]), [])
})
