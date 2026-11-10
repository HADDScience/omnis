/** 입력칸 Enter — 폰은 줄바꿈 · PC 는 보내기 · 한글 조합 중에는 보내지 않는다. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"

import { enterSends } from "./enter-to-send"

const key = (k: string, o: { shift?: boolean; composing?: boolean; keyCode?: number } = {}) => ({
  key: k,
  shiftKey: !!o.shift,
  nativeEvent: { isComposing: o.composing, keyCode: o.keyCode },
})

test("PC — Enter 는 보내고 Shift+Enter 는 줄바꿈", () => {
  assert.equal(enterSends(key("Enter"), false), true)
  assert.equal(enterSends(key("Enter", { shift: true }), false), false)
})

test("폰 — Enter 는 보내지 않는다 (거부되어야 하는 경우)", () => {
  assert.equal(enterSends(key("Enter"), true), false)
  assert.equal(enterSends(key("Enter", { shift: true }), true), false)
})

test("한글 조합 중 Enter 는 어느 기기에서도 보내지 않는다 — isComposing · Safari keyCode 229", () => {
  assert.equal(enterSends(key("Enter", { composing: true }), false), false)
  assert.equal(enterSends(key("Enter", { keyCode: 229 }), false), false)
})

test("Enter 가 아닌 키는 보내지 않는다", () => {
  assert.equal(enterSends(key("a"), false), false)
})
