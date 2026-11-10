/** 확인 카드 규칙 — 확인 없이 쓰기 불가 · 보인 제안에만 · 한 번만. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"

import { checkDecision, checkExecution, planHash, stableStringify, type StepForCheck } from "./approval"

const input = { name: "에이전트 확인 흐름 점검", assignees: ["윤훈"], deadline: "2026-11-05" }
const preview = { title: "새 업무 만들기", target: input.name, changes: [], risk: "…" }
const hash = planHash({ runId: "r1", toolCallId: "c1", toolName: "create_task", input, preview })
const step = (over: Partial<StepForCheck> = {}): StepForCheck => ({
  status: "PENDING", toolName: "create_task", input, planHash: hash, blockedReason: null, ...over,
})
const req = (over: Partial<Parameters<typeof checkDecision>[1]> = {}) => ({
  userId: "u1", ownerId: "u1", decision: "approve" as const, planHash: hash, ...over,
})

test("해시는 키 순서와 무관하고, 내용이 바뀌면 달라진다", () => {
  assert.equal(stableStringify({ b: 1, a: [{ d: 2, c: 3 }] }), stableStringify({ a: [{ c: 3, d: 2 }], b: 1 }))
  const same = planHash({ runId: "r1", toolCallId: "c1", toolName: "create_task", input: { deadline: "2026-11-05", assignees: ["윤훈"], name: input.name }, preview })
  assert.equal(same, hash)
  assert.notEqual(planHash({ runId: "r1", toolCallId: "c1", toolName: "create_task", input: { ...input, deadline: "2026-11-06" }, preview }), hash)
  assert.notEqual(planHash({ runId: "r1", toolCallId: "c1", toolName: "create_task", input, preview: { ...preview, risk: "다름" } }), hash)
  assert.notEqual(planHash({ runId: "r2", toolCallId: "c1", toolName: "create_task", input, preview }), hash)
})

test("승인: PENDING · 해시 일치 · 본인이면 통과", () => {
  assert.deepEqual(checkDecision(step(), req()), { ok: true })
  assert.deepEqual(checkDecision(step(), req({ decision: "reject" })), { ok: true })
})

test("승인 거부: 화면의 제안과 해시가 다르다", () => {
  const r = checkDecision(step(), req({ planHash: "0".repeat(64) }))
  assert.equal(r.ok, false)
  assert.equal(!r.ok && r.status, 409)
})

test("승인 거부: 남의 카드는 없는 것처럼 404", () => {
  const r = checkDecision(step(), req({ userId: "u2" }))
  assert.equal(!r.ok && r.status, 404)
  assert.equal(checkDecision(null, req()).ok, false)
})

test("재사용 승인 거부: 이미 승인 · 실행 · 취소 · 지나간 카드", () => {
  for (const status of ["APPROVED", "EXECUTED", "REJECTED", "FAILED", "EXPIRED"] as const) {
    const r = checkDecision(step({ status }), req())
    assert.equal(r.ok, false, status)
    assert.equal(!r.ok && r.status, 409, status)
  }
})

test("막힌 카드는 승인할 수 없다", () => {
  const r = checkDecision(step({ status: "BLOCKED", blockedReason: "비밀번호로 보이는 값" }), req())
  assert.equal(r.ok, false)
  assert.ok(!r.ok && r.error.includes("비밀번호"))
})

test("승인 순간에도 비밀을 다시 본다 — 카드가 PENDING 이어도", () => {
  const r = checkDecision(step({ input: { ...input, checklist: ["PC 비번: hadd!0423"] } }), req())
  assert.equal(r.ok, false)
  // 취소는 막지 않는다
  assert.equal(checkDecision(step({ input: { ...input, checklist: ["PC 비번: hadd!0423"] } }), req({ decision: "reject" })).ok, true)
})

test("확인 없이 쓰기 불가: 카드가 없으면 실행하지 않는다", () => {
  const r = checkExecution(null, { toolName: "create_task", input })
  assert.equal(r.ok, false)
  assert.equal(!r.ok && r.status, 403)
})

test("확인 없이 쓰기 불가: 확인 대기 · 취소 · 막힘 · 지나감은 실행하지 않는다", () => {
  for (const status of ["PENDING", "REJECTED", "BLOCKED", "EXPIRED", "FAILED"] as const) {
    assert.equal(checkExecution(step({ status }), { toolName: "create_task", input }).ok, false, status)
  }
})

test("재사용 승인 거부: 이미 실행한 카드로 다시 실행하지 않는다", () => {
  const r = checkExecution(step({ status: "EXECUTED" }), { toolName: "create_task", input })
  assert.equal(r.ok, false)
  assert.ok(!r.ok && r.error.includes("한 번만"))
})

test("확인한 것과 다른 도구 · 입력은 실행하지 않는다", () => {
  assert.equal(checkExecution(step({ status: "APPROVED" }), { toolName: "update_task", input }).ok, false)
  assert.equal(checkExecution(step({ status: "APPROVED" }), { toolName: "create_task", input: { ...input, assignees: ["허채정"] } }).ok, false)
})

test("확인된 같은 입력은 실행한다 — 키 순서가 달라도", () => {
  const r = checkExecution(step({ status: "APPROVED" }), { toolName: "create_task", input: { deadline: "2026-11-05", name: input.name, assignees: ["윤훈"] } })
  assert.deepEqual(r, { ok: true })
})

test("실행 직전에도 비밀을 본다 — APPROVED 라도", () => {
  const bad = { ...input, background: "공용 PC 비밀번호는 hadd2024!" }
  assert.equal(checkExecution(step({ status: "APPROVED", input: bad }), { toolName: "create_task", input: bad }).ok, false)
})
