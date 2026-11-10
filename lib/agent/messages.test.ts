/** 대화 속 승인 요청 · 응답과 화면 스트림 접기. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"
import type { ModelMessage } from "ai"

import { approvalResponses, pendingApprovals } from "./messages"
import { EMPTY_LIVE, foldChunk, liveText } from "./client-stream"

const asked: ModelMessage[] = [
  { role: "user", content: "윤훈 담당으로 업무 만들어 줘" },
  {
    role: "assistant",
    content: [
      { type: "tool-call", toolCallId: "c1", toolName: "create_task", input: { name: "점검", assignees: ["윤훈"] } },
      { type: "tool-approval-request", approvalId: "approval-c1", toolCallId: "c1" },
    ],
  } as ModelMessage,
]

test("응답이 없는 승인 요청을 도구 이름 · 입력과 함께 찾는다", () => {
  assert.deepEqual(pendingApprovals(asked), [
    { approvalId: "approval-c1", toolCallId: "c1", toolName: "create_task", input: { name: "점검", assignees: ["윤훈"] } },
  ])
})

test("응답을 붙이면 더는 기다리는 것이 아니다", () => {
  const next = [...asked, approvalResponses([{ approvalId: "approval-c1", status: "APPROVED", blockedReason: null }])]
  assert.deepEqual(pendingApprovals(next), [])
})

test("취소 · 막힘은 approved=false 와 이유", () => {
  const m = approvalResponses([
    { approvalId: "a", status: "REJECTED", blockedReason: null },
    { approvalId: "b", status: "BLOCKED", blockedReason: "비밀번호로 보이는 값" },
    { approvalId: "c", status: "APPROVED", blockedReason: null },
  ])
  const parts = m.content as { approvalId: string; approved: boolean; reason?: string }[]
  assert.deepEqual(parts.map((p) => p.approved), [false, false, true])
  assert.match(parts[0].reason ?? "", /취소/)
  assert.match(parts[1].reason ?? "", /비밀번호/)
  assert.equal(parts[2].reason, undefined)
})

test("스트림 접기 — 단계마다 글을 나누고, 재시도(reset-step)는 그 단계 글을 버린다", () => {
  const chunks = [
    { type: "start-step" }, { type: "tool-input-start", toolCallId: "t1", toolName: "list_tasks" },
    { type: "tool-output-available", toolCallId: "t1" }, { type: "finish-step" },
    { type: "start-step" }, { type: "text-delta", delta: "틀린" }, { type: "reset-step" }, { type: "text-delta", delta: "10건" },
    { type: "tool-input-start", toolCallId: "t2", toolName: "create_task" }, { type: "tool-approval-request", toolCallId: "t2" },
  ]
  const live = chunks.reduce(foldChunk, EMPTY_LIVE)
  assert.equal(liveText(live), "10건")
  assert.deepEqual(live.tools.map((t) => [t.name, t.state]), [["list_tasks", "done"], ["create_task", "approval"]])
})
