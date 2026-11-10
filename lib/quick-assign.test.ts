import { test } from "node:test"
import assert from "node:assert/strict"
import { quickAssignChoices, showQuickAssign } from "./quick-assign"

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
