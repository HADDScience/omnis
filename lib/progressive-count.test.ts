import { test } from "node:test"
import assert from "node:assert/strict"
import { nextRevealCount } from "./progressive-count"

test("한 번에 step 개씩 더 그린다", () => {
  assert.equal(nextRevealCount(30, 687, 40), 70)
  assert.equal(nextRevealCount(70, 687, 40), 110)
})

test("남은 것이 step 의 절반도 안 되면 끝까지 — 끝에서 한 번 더 기다리지 않게", () => {
  assert.equal(nextRevealCount(30, 85, 40), 85)
  assert.equal(nextRevealCount(30, 100, 40), 70)
})

test("다 그렸으면 그대로 · 넘치지 않는다", () => {
  assert.equal(nextRevealCount(50, 50, 40), 50)
  assert.equal(nextRevealCount(60, 50, 40), 50)
})
