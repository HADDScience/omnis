import { test } from "node:test"
import assert from "node:assert/strict"
import { isKeyboardOpen, isTextEntry, rememberBaseline } from "./keyboard-viewport"

const open = { phone: true, textEntryFocused: true, baseline: 844, height: 450 }

test("폰에서 글자 칸에 포커스가 있고 높이가 크게 줄면 키보드다", () => {
  assert.equal(isKeyboardOpen(open), true)
})

test("높이가 그대로면 포커스가 있어도 키보드가 아니다 — 물리 키보드", () => {
  assert.equal(isKeyboardOpen({ ...open, height: 844 }), false)
})

test("높이가 조금 줄면 키보드가 아니다 — 주소창 · 물리 키보드의 제안 막대", () => {
  assert.equal(isKeyboardOpen({ ...open, height: 844 - 119 }), false)
  assert.equal(isKeyboardOpen({ ...open, height: 844 - 120 }), true)
})

test("높이가 줄어도 글자 칸에 포커스가 없으면 키보드가 아니다 — 창 크기 조절", () => {
  assert.equal(isKeyboardOpen({ ...open, textEntryFocused: false }), false)
})

test("폰이 아니면 언제나 아니다 — PC 의 좁은 창", () => {
  assert.equal(isKeyboardOpen({ ...open, phone: false }), false)
})

test("평소 높이는 폭마다 가장 큰 값을 기억한다 — 키보드가 열린 높이로 내려가지 않는다", () => {
  const b = new Map<number, number>()
  assert.equal(rememberBaseline(b, 390, 844), 844)
  assert.equal(rememberBaseline(b, 390, 450), 844)
  assert.equal(rememberBaseline(b, 844, 390), 390)
  assert.equal(rememberBaseline(b, 844, 200), 390)
  assert.equal(rememberBaseline(b, 390, 500), 844)
})

test("글자를 치는 칸만 입력 칸으로 본다", () => {
  assert.equal(isTextEntry(null), false)
  assert.equal(isTextEntry({ tagName: "BODY" }), false)
  assert.equal(isTextEntry({ tagName: "BUTTON" }), false)
  assert.equal(isTextEntry({ tagName: "TEXTAREA" }), true)
  assert.equal(isTextEntry({ tagName: "TEXTAREA", readOnly: true }), false)
  assert.equal(isTextEntry({ tagName: "INPUT", type: "search" }), true)
  assert.equal(isTextEntry({ tagName: "INPUT", type: "checkbox" }), false)
  assert.equal(isTextEntry({ tagName: "INPUT", type: "text", disabled: true }), false)
  assert.equal(isTextEntry({ tagName: "DIV", isContentEditable: true }), true)
})
