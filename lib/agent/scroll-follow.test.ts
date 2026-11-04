/** 옴니스 방 따라가기 판정. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"

import { distanceFromBottom, isStuckToBottom, prependScrollDelta, STICK_THRESHOLD } from "./scroll-follow"

const view = 600

test("맨 아래면 붙어 있다", () => {
  assert.equal(isStuckToBottom({ scrollTop: 1400, clientHeight: view, scrollHeight: 2000 }), true)
})

test("아래에서 임계값 안이면 붙어 있다 · 경계 포함", () => {
  assert.equal(isStuckToBottom({ scrollTop: 1400 - STICK_THRESHOLD, clientHeight: view, scrollHeight: 2000 }), true)
})

test("거부 — 임계값을 1px 넘으면 떨어진 것이다(따라가지 않는다)", () => {
  assert.equal(isStuckToBottom({ scrollTop: 1400 - STICK_THRESHOLD - 1, clientHeight: view, scrollHeight: 2000 }), false)
})

test("거부 — 위로 한참 올린 사용자는 답이 길어져도 따라가지 않는다", () => {
  // 위로 올린 자리(scrollTop 300)에서 답이 늘어 scrollHeight 만 커졌다
  assert.equal(isStuckToBottom({ scrollTop: 300, clientHeight: view, scrollHeight: 2000 }), false)
  assert.equal(isStuckToBottom({ scrollTop: 300, clientHeight: view, scrollHeight: 2600 }), false)
})

test("직접 맨 아래로 내리면 다시 붙는다", () => {
  assert.equal(isStuckToBottom({ scrollTop: 300, clientHeight: view, scrollHeight: 2000 }), false)
  assert.equal(isStuckToBottom({ scrollTop: 1400, clientHeight: view, scrollHeight: 2000 }), true)
})

test("내용이 칸보다 짧으면 늘 붙어 있다", () => {
  assert.equal(isStuckToBottom({ scrollTop: 0, clientHeight: view, scrollHeight: 400 }), true)
  assert.equal(distanceFromBottom({ scrollTop: 0, clientHeight: view, scrollHeight: 400 }), 0)
})

test("iOS 고무줄 스크롤(음수 · 초과)에도 거리는 0 이상", () => {
  assert.equal(distanceFromBottom({ scrollTop: 1500, clientHeight: view, scrollHeight: 2000 }), 0)
  assert.equal(distanceFromBottom({ scrollTop: -20, clientHeight: view, scrollHeight: 2000 }), 1420)
})

test("앞 글을 붙이면 늘어난 높이만큼 내려 보던 자리를 지킨다", () => {
  assert.equal(prependScrollDelta(2000, 3500), 1500)
  assert.equal(prependScrollDelta(2000, 2000), 0)
  assert.equal(prependScrollDelta(2000, 1800), 0)
})
