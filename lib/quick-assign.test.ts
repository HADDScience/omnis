import { test } from "node:test"
import assert from "node:assert/strict"
import { pruneAssignOverrides, quickAssignChoices, showQuickAssign, withAssignOverrides } from "./quick-assign"

test("미완료 · 담당 0명이면 칸을 띄운다", () => {
  assert.equal(showQuickAssign({ status: "TODO", assignees: [] }), true)
  assert.equal(showQuickAssign({ status: "REVIEW", assignees: [] }), true)
})

test("담당이 있거나 완료면 띄우지 않는다", () => {
  assert.equal(showQuickAssign({ status: "TODO", assignees: [{ id: "a" }] }), false)
  assert.equal(showQuickAssign({ status: "DONE", assignees: [] }), false)
})

test("과거 구성원은 칩에서 뺀다", () => {
  const out = quickAssignChoices([
    { id: "a", name: "사원1" },
    { id: "b", name: "사원2", former: true },
  ])
  assert.deepEqual(out.map((u) => u.id), ["a"])
})

test("검색은 공백 · 대소문자를 무시하고 이름 일부로 맞춘다", () => {
  const people = [
    { id: "a", name: "팀장" },
    { id: "b", name: "부 팀장" },
    { id: "c", name: "Kim Lee" },
  ]
  assert.deepEqual(quickAssignChoices(people, "팀 장").map((u) => u.id), ["a", "b"])
  assert.deepEqual(quickAssignChoices(people, "kimlee").map((u) => u.id), ["c"])
  assert.deepEqual(quickAssignChoices(people, "없음"), [])
})

test("목록 — 고른 사람을 먼저 그리고, 서버가 담당 있음으로 내려 준 업무는 덮지 않는다", () => {
  const tasks = [
    { id: "t1", unassigned: true, ownerName: null },
    { id: "t2", unassigned: false, ownerName: "가" },
  ]
  const next = withAssignOverrides(tasks, { t1: { id: "u1", name: "나" }, t2: { id: "u2", name: "다" } })
  assert.deepEqual(next[0], { id: "t1", unassigned: false, ownerName: "나" })
  assert.equal(next[1], tasks[1])
  // 덮을 것이 없으면 같은 배열 — 보드가 끌던 상태를 버리지 않는다
  assert.equal(withAssignOverrides(tasks, {}), tasks)
  assert.equal(withAssignOverrides(tasks, { t2: { id: "u2", name: "다" } }), tasks)
})

test("목록 — 서버 값이 따라오면 덮어쓰기를 걷는다", () => {
  const o = { t1: { id: "u1", name: "나" }, t2: { id: "u2", name: "다" } }
  assert.equal(pruneAssignOverrides(o, [{ id: "t1", unassigned: true }, { id: "t2", unassigned: true }]), o)
  assert.deepEqual(pruneAssignOverrides(o, [{ id: "t1", unassigned: true }, { id: "t2", unassigned: false }]), { t1: o.t1 })
  assert.deepEqual(pruneAssignOverrides(o, []), {})
})
