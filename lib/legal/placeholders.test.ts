import { test } from "node:test"
import assert from "node:assert/strict"
import { CONTACT_PLACEHOLDER, legalContact } from "./placeholders"

test("문의처 — 설정값이 이메일 · 주소면 그것, 아니면 자리표시", () => {
  assert.deepEqual(legalContact(" help@example.com "), { kind: "email", value: "help@example.com", href: "mailto:help@example.com" })
  assert.deepEqual(legalContact("https://example.com/contact"), { kind: "url", value: "https://example.com/contact", href: "https://example.com/contact" })
  for (const bad of [undefined, "", "   ", "javascript:alert(1)", "전화 주세요", "a@b"]) {
    assert.deepEqual(legalContact(bad), { kind: "placeholder", value: CONTACT_PLACEHOLDER }, String(bad))
  }
})
