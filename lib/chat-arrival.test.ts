import { test } from "node:test"
import assert from "node:assert/strict"
import { ARRIVAL_DURATION_MS, ARRIVAL_KEYFRAMES, arrivalEffects } from "./chat-arrival"

const base = { typing: false, sameTarget: false, reducedMotion: false, textMarked: true }

test("누른 이동은 튕긴다. 글자 표시가 있으면 말풍선은 칠하지 않는다", () => {
  assert.deepEqual(arrivalEffects(base), { bounce: true, flash: false })
  assert.deepEqual(arrivalEffects({ ...base, textMarked: false }), { bounce: true, flash: true })
})

test("같은 결과를 다시 눌러도 튕긴다", () => {
  assert.deepEqual(arrivalEffects({ ...base, sameTarget: true }), { bounce: true, flash: false })
})

test("움직임 줄이기는 튕기지 않고 강조만 한다", () => {
  assert.deepEqual(arrivalEffects({ ...base, reducedMotion: true }), { bounce: false, flash: true })
})

test("검색어를 고치는 동안 같은 글에 머물면 알리지 않고, 글이 바뀌면 알린다", () => {
  assert.deepEqual(arrivalEffects({ ...base, typing: true, sameTarget: true }), { bounce: false, flash: false })
  assert.deepEqual(arrivalEffects({ ...base, typing: true }), { bounce: true, flash: false })
})

test("1초 안팎으로 한 번 튕기고 제자리에서 끝난다", () => {
  assert.ok(ARRIVAL_DURATION_MS >= 700 && ARRIVAL_DURATION_MS <= 1200)
  assert.equal(ARRIVAL_KEYFRAMES.at(0)?.transform, "translateY(0)")
  assert.equal(ARRIVAL_KEYFRAMES.at(-1)?.transform, "translateY(0)")
})
