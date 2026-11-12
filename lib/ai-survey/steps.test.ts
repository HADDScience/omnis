import assert from "node:assert/strict"
import { test } from "node:test"

import type { Field } from "./rules"
import { isAnswered, startStep, stepNav } from "./steps"

// 「일주일 중 쓰는 날 수」(슬라이더) + 「하루에 묻는 횟수」(구간 칩) — 범위 칸 둘이 묶인 질문
const fields: Pick<Field, "id" | "kind">[] = [{ id: "f1", kind: "slider" }, { id: "f2", kind: "bucket" }]

test("첫 칸 — 이전 없음, 다음은 이 칸을 고른 뒤에만", () => {
  assert.deepEqual(stepNav(fields, {}, 0), { index: 0, total: 2, prev: false, action: "next", enabled: false })
  assert.equal(stepNav(fields, { f1: { num: 4 } }, 0).enabled, true)
  // 「잘 모르겠음」 도 고른 것이다
  assert.equal(stepNav(fields, { f1: { unknown: true } }, 0).enabled, true)
  // 다른 칸만 골랐으면 다음으로 갈 수 없다
  assert.equal(stepNav(fields, { f2: { choice: ["o1"] } }, 0).enabled, false)
})

test("마지막 칸 — 다음 대신 보내기, 모든 칸이 찼을 때만", () => {
  const nav = stepNav(fields, { f1: { num: 4 } }, 1)
  assert.equal(nav.action, "send")
  assert.equal(nav.prev, true)
  assert.equal(nav.enabled, false)
  assert.equal(stepNav(fields, { f1: { num: 4 }, f2: { choice: ["o2"] } }, 1).enabled, true)
  // 앞 칸이 비었으면 마지막 칸을 골라도 보낼 수 없다
  assert.equal(stepNav(fields, { f2: { choice: ["o2"] } }, 1).enabled, false)
})

test("칸 수를 넘는 자리는 안으로 맞춘다", () => {
  assert.equal(stepNav(fields, {}, 5).index, 1)
  assert.equal(stepNav(fields, {}, -1).index, 0)
  assert.equal(stepNav(fields.slice(0, 1), { f1: { num: 0 } }, 0).action, "send")
})

test("세 칸 — 가운데는 이전 · 다음 둘 다", () => {
  const three = [...fields, { id: "f3", kind: "scale" as const }]
  assert.deepEqual(stepNav(three, { f2: { choice: ["o1"] } }, 1), { index: 1, total: 3, prev: true, action: "next", enabled: true })
})

test("시작 칸 — 말에서 읽은 값으로 맞춘 칸이 있으면 그 칸", () => {
  assert.equal(startStep(fields), 0)
  assert.equal(startStep(fields, "f2"), 1)
  assert.equal(startStep(fields, "없는칸"), 0)
})

test("답이 찼나 — 칸 종류대로", () => {
  assert.equal(isAnswered({ kind: "slider" }, { num: 0 }), true)
  assert.equal(isAnswered({ kind: "slider" }, { num: Number.NaN }), false)
  assert.equal(isAnswered({ kind: "multi" }, { choice: [] }), false)
  assert.equal(isAnswered({ kind: "single" }, { choice: ["a", "b"] }), false)
  assert.equal(isAnswered({ kind: "bucket" }, undefined), false)
})
