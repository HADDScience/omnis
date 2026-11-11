import { test } from "node:test"
import assert from "node:assert/strict"
import { assignSummary, assigneeDiff, canSaveAssignees, pruneAssignOverrides, quickAssignChoices, sameAssignees, showQuickAssign, toggleAssignee, withAssignOverrides } from "./quick-assign"
import { assigneeStack } from "./task-assignees"

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

test("목록 — 고른 사람들을 먼저 그리고, 서버 값이 이미 같으면 덮지 않는다", () => {
  const ga = { id: "u0", name: "가" }
  const na = { id: "u1", name: "나" }
  const da = { id: "u2", name: "다" }
  const tasks = [
    { id: "t1", unassigned: true, ownerName: null, owners: [] },
    { id: "t2", unassigned: false, ownerName: "가", owners: [ga] },
  ]
  const next = withAssignOverrides(tasks, { t1: [na, da], t2: [ga, da] })
  assert.deepEqual(next[0], { id: "t1", unassigned: false, ownerName: "나, 다", owners: [na, da] })
  // 이미 담당이 있는 업무도 고친 대로 — 사람을 더하거나 뺀다
  assert.deepEqual(next[1].owners, [ga, da])
  // 덮을 것이 없거나 서버 값과 같으면 같은 배열 — 보드가 끌던 상태를 버리지 않는다
  assert.equal(withAssignOverrides(tasks, {}), tasks)
  assert.equal(withAssignOverrides(tasks, { t2: [ga] }), tasks)
  // 4명 이상이면 「외 n명」
  const four = [ga, na, da, { id: "u3", name: "라" }]
  assert.equal(withAssignOverrides(tasks, { t1: four })[0].ownerName, "가, 나, 다 외 1명")
})

test("목록 — 서버 값이 고른 사람들로 따라오면 덮어쓰기를 걷는다", () => {
  const na = { id: "u1", name: "나" }
  const da = { id: "u2", name: "다" }
  const o = { t1: [na], t2: [na, da] }
  assert.equal(pruneAssignOverrides(o, [{ id: "t1", owners: [] }, { id: "t2", owners: [na] }]), o)
  // 순서가 달라도 같은 사람들이면 따라온 것
  assert.deepEqual(pruneAssignOverrides(o, [{ id: "t1", owners: [] }, { id: "t2", owners: [da, na] }]), { t1: o.t1 })
  assert.deepEqual(pruneAssignOverrides(o, []), {})
})

test("여러 명 — 넣고 빼기 · 차이 · 저장 가능 · 안내", () => {
  assert.deepEqual(toggleAssignee(["a"], "b"), ["a", "b"])
  assert.deepEqual(toggleAssignee(["a", "b"], "a"), ["b"])
  assert.deepEqual(assigneeDiff(["a", "b"], ["b", "c"]), { added: ["c"], removed: ["a"] })
  assert.deepEqual(assigneeDiff([], ["a", "a"]), { added: ["a"], removed: [] })
  assert.equal(sameAssignees(["a", "b"], ["b", "a"]), true)
  assert.equal(canSaveAssignees(["a"], ["a"]), false)
  assert.equal(canSaveAssignees(["a"], []), false)
  assert.equal(canSaveAssignees(["a"], ["a", "b"]), true)
  const people = [{ id: "a", name: "가" }, { id: "b", name: "나" }, { id: "c", name: "다" }]
  assert.equal(assignSummary(["a"], ["b", "c"], people), "나 · 다님 지정 · 가님 해제")
  assert.equal(assignSummary([], ["a"], people), "가님 지정")
  assert.equal(assignSummary(["a"], ["a"], people), "바뀐 담당이 없어요")
})

test("겹친 아바타 — 3명까지 얼굴, 넘으면 「외 n명」", () => {
  assert.deepEqual(assigneeStack(["a", "b"]), { shown: ["a", "b"], rest: 0 })
  assert.deepEqual(assigneeStack(["a", "b", "c", "d", "e"]), { shown: ["a", "b", "c"], rest: 2 })
  assert.deepEqual(assigneeStack(["a", "b", "c"], 2), { shown: ["a", "b"], rest: 1 })
})
