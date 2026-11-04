import { test } from "node:test"
import assert from "node:assert/strict"
import { comboFromEvent, DEFAULT_SHORTCUTS, formatCombo, matchesCombo, sanitizeShortcuts, shortcutProblem, SHORTCUTS } from "./shortcuts"

const key = (code: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}) => ({
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
})

test("맥 ⌘ 과 윈도우 Ctrl 은 같은 Mod 다", () => {
  assert.equal(comboFromEvent(key("KeyK", { metaKey: true })), "Mod+KeyK")
  assert.equal(comboFromEvent(key("KeyK", { ctrlKey: true })), "Mod+KeyK")
})

test("조합키만 누른 것은 아직 키가 아니다", () => {
  for (const code of ["MetaLeft", "ControlRight", "AltLeft", "ShiftRight"]) {
    assert.equal(comboFromEvent(key(code, { shiftKey: true })), null)
  }
})

test("한글 입력 중의 ㅊ 도 자리(code)로 잡힌다", () => {
  assert.equal(matchesCombo({ ...key("KeyC", { altKey: true, shiftKey: true }) }, DEFAULT_SHORTCUTS.togglePanel), true)
})

test("조합키가 다르면 맞지 않는다 — 키 하나로는 동작하지 않는다", () => {
  assert.equal(matchesCombo(key("KeyD"), DEFAULT_SHORTCUTS.toggleTheme), false)
  assert.equal(matchesCombo(key("KeyC"), DEFAULT_SHORTCUTS.togglePanel), false)
  assert.equal(matchesCombo(key("KeyK", { metaKey: true, shiftKey: true }), DEFAULT_SHORTCUTS.commandPalette), false)
})

test("기본 단축키는 모두 규칙을 통과하고 서로 겹치지 않는다", () => {
  for (const { id, combo } of SHORTCUTS) {
    assert.equal(shortcutProblem(combo, id, DEFAULT_SHORTCUTS), null, id)
  }
  assert.equal(new Set(Object.values(DEFAULT_SHORTCUTS)).size, SHORTCUTS.length)
})

test("조합키 없는 키는 거부한다", () => {
  assert.match(shortcutProblem("KeyD", "toggleTheme", DEFAULT_SHORTCUTS) ?? "", /함께 눌러/)
  assert.match(shortcutProblem("Shift+KeyD", "toggleTheme", DEFAULT_SHORTCUTS) ?? "", /함께 눌러/)
  assert.match(shortcutProblem("F2", "toggleTheme", DEFAULT_SHORTCUTS) ?? "", /함께 눌러/)
})

test("글자 · 숫자가 아닌 키는 거부한다", () => {
  assert.match(shortcutProblem("Mod+Enter", "toggleTheme", DEFAULT_SHORTCUTS) ?? "", /글자나 숫자/)
  assert.match(shortcutProblem("Alt+Tab", "toggleTheme", DEFAULT_SHORTCUTS) ?? "", /글자나 숫자/)
})

test("다른 단축키가 쓰는 키는 거부하고, 자기 키는 받는다", () => {
  assert.match(shortcutProblem(DEFAULT_SHORTCUTS.togglePanel, "toggleTheme", DEFAULT_SHORTCUTS) ?? "", /대화 패널/)
  assert.equal(shortcutProblem(DEFAULT_SHORTCUTS.toggleTheme, "toggleTheme", DEFAULT_SHORTCUTS), null)
})

test("주요 브라우저 단축키는 거부한다", () => {
  for (const combo of ["Mod+KeyT", "Mod+KeyW", "Mod+KeyD", "Mod+KeyC", "Mod+KeyV", "Mod+KeyR", "Mod+KeyL", "Mod+Digit1", "Mod+Shift+KeyI", "Alt+KeyD"]) {
    assert.match(shortcutProblem(combo, "toggleTheme", DEFAULT_SHORTCUTS) ?? "", /브라우저/, combo)
  }
})

test("겹치지 않는 조합은 받는다", () => {
  assert.equal(shortcutProblem("Alt+Shift+KeyX", "toggleTheme", DEFAULT_SHORTCUTS), null)
  assert.equal(shortcutProblem("Mod+Shift+KeyK", "toggleTheme", DEFAULT_SHORTCUTS), null)
})

test("저장값이 깨졌거나 규칙에 어긋나면 그 항목만 기본값으로 돌아간다", () => {
  assert.deepEqual(sanitizeShortcuts(null), DEFAULT_SHORTCUTS)
  assert.deepEqual(sanitizeShortcuts("x"), DEFAULT_SHORTCUTS)
  const saved = sanitizeShortcuts({ toggleTheme: "KeyD", togglePanel: "Alt+Shift+KeyX", unknown: "Alt+KeyQ" })
  assert.deepEqual(saved, { ...DEFAULT_SHORTCUTS, togglePanel: "Alt+Shift+KeyX" })
})

test("저장값끼리 겹치면 한쪽을 기본값으로 돌려 둘 다 살지 않게 한다", () => {
  const saved = sanitizeShortcuts({ togglePanel: "Alt+Shift+KeyX", toggleTheme: "Alt+Shift+KeyX" })
  assert.equal(new Set(Object.values(saved)).size, SHORTCUTS.length)
})

test("앞 항목이 뒤 항목의 기본값을 빼앗은 저장값은 되돌린다", () => {
  const saved = sanitizeShortcuts({ togglePanel: DEFAULT_SHORTCUTS.toggleTheme })
  assert.equal(new Set(Object.values(saved)).size, SHORTCUTS.length)
})

test("맥과 윈도우의 표기", () => {
  assert.equal(formatCombo("Mod+Shift+KeyF", true), "⌘⇧F")
  assert.equal(formatCombo("Mod+Shift+KeyF", false), "Ctrl+Shift+F")
  assert.equal(formatCombo("Alt+Shift+Digit1", true), "⌥⇧1")
})
