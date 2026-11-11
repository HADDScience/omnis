import { test } from "node:test"
import assert from "node:assert/strict"
import { SWIPE, swipeArmed, swipeCrossed, swipeIntent, swipeOffset, swipeStartAllowed } from "./swipe-reply"

const start = { x: 100, y: 300, t: 0 }

test("왼쪽 가장자리(20px 안)에서 시작한 손가락은 잡지 않는다 — iOS 뒤로 가기", () => {
  assert.equal(swipeStartAllowed(0), false)
  assert.equal(swipeStartAllowed(19), false)
  assert.equal(swipeStartAllowed(20), true)
  assert.equal(swipeStartAllowed(200), true)
})

test("처음 10px 안에서는 정하지 않는다", () => {
  assert.equal(swipeIntent(start, 100, 300, 10), "pending")
  assert.equal(swipeIntent(start, 109, 305, 50), "pending")
  assert.equal(swipeIntent(start, 95, 293, 50), "pending")
})

test("가로(오른쪽) 이동이 세로보다 크면 잡는다", () => {
  assert.equal(swipeIntent(start, 112, 303, 60), "swipe")
  assert.equal(swipeIntent(start, 130, 320, 80), "swipe")
})

test("세로가 크거나 같으면 · 왼쪽이면 놓아 둔다(세로 스크롤 · 다른 몸짓)", () => {
  assert.equal(swipeIntent(start, 105, 315, 60), "cancel")
  assert.equal(swipeIntent(start, 112, 312, 60), "cancel")
  assert.equal(swipeIntent(start, 88, 301, 60), "cancel")
  assert.equal(swipeIntent(start, 100, 280, 60), "cancel")
})

test("움직이지 않고 오래 누르면 길게 누르기 — 그 뒤 옆으로 끌어도 잡지 않는다", () => {
  assert.equal(swipeIntent(start, 102, 301, SWIPE.longPress - 1), "pending")
  assert.equal(swipeIntent(start, 102, 301, SWIPE.longPress), "cancel")
  assert.equal(swipeIntent(start, 140, 301, SWIPE.longPress + 100), "cancel")
})

test("끌린 거리 — 0 에서 손가락을 거의 그대로 따르고, 점점 무거워져 72px 을 넘지 않는다", () => {
  assert.equal(swipeOffset(0), 0)
  assert.equal(swipeOffset(-30), 0)
  assert.equal(swipeOffset(Number.NaN), 0)
  // 처음 10px 은 거의 그대로(감쇠 10% 안쪽)
  assert.ok(swipeOffset(10) > 9 && swipeOffset(10) < 10)
  // 단조 증가 · 감쇠
  let prev = 0
  for (let dx = 5; dx <= 600; dx += 5) {
    const o = swipeOffset(dx)
    assert.ok(o > prev, `dx=${dx}`)
    assert.ok(o < dx)
    assert.ok(o < SWIPE.max)
    prev = o
  }
  assert.ok(swipeOffset(1000) > 71.9)
})

test("48px 끌리면 답장 준비 — 손가락 약 79px", () => {
  assert.equal(swipeArmed(swipeOffset(70)), false)
  assert.equal(swipeArmed(swipeOffset(80)), true)
  assert.equal(swipeArmed(47.9), false)
  assert.equal(swipeArmed(48), true)
})

test("햅틱은 준비 선을 넘는 순간 한 번", () => {
  assert.equal(swipeCrossed(40, 50), true)
  assert.equal(swipeCrossed(50, 60), false)
  assert.equal(swipeCrossed(60, 40), false)
  assert.equal(swipeCrossed(30, 40), false)
})
