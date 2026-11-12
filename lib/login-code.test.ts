/** 로그인 코드 규칙 — 해시 · 10분 · 1회용 · 틀린 횟수 · 웍스 메일. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"
import { CODE_LIMITS, CODE_TTL_MS, activeCode, codeMail, codeMatches, generateCode, hashCode, isCodeShape, isWorksMail } from "./login-code"

const S = "secret"
const t0 = 1_800_000_000_000
const at = (ms: number) => new Date(t0 + ms)

test("코드는 6자리 숫자, 해시만 맞춰 본다", () => {
  for (let i = 0; i < 50; i++) assert.ok(isCodeShape(generateCode()))
  const h = hashCode("u1", "012345", S)
  assert.notEqual(h, "012345")
  assert.ok(codeMatches("u1", "012345", h, S))
  assert.ok(!codeMatches("u1", "012346", h, S))
  assert.ok(!codeMatches("u2", "012345", h, S))
})

test("10분이 지나면 · 쓴 뒤에는 · 5번 틀리면 끝", () => {
  const issued = { action: "issued", title: "h", createdAt: at(0) }
  assert.deepEqual(activeCode([issued], t0 + 1000), { hash: "h", wrong: 0 })
  assert.equal(activeCode([issued], t0 + CODE_TTL_MS + 1), null)
  assert.equal(activeCode([issued, { action: "used", title: "", createdAt: at(10) }], t0 + 20), null)
  const wrongs = Array.from({ length: CODE_LIMITS.wrongPerCode }, (_, i) => ({ action: "wrong", title: "", createdAt: at(i + 1) }))
  assert.equal(activeCode([issued, ...wrongs], t0 + 100), null)
  assert.equal(activeCode([issued, ...wrongs.slice(1)], t0 + 100)?.wrong, CODE_LIMITS.wrongPerCode - 1)
})

test("새로 받으면 앞의 코드는 끝난다 — 가장 최근 발급만", () => {
  const logs = [
    { action: "issued", title: "old", createdAt: at(0) },
    { action: "used", title: "", createdAt: at(5) },
    { action: "issued", title: "new", createdAt: at(10) },
  ]
  assert.equal(activeCode(logs, t0 + 20)?.hash, "new")
})

test("웍스 메일만", () => {
  assert.ok(isWorksMail("A@HaddScience.com "))
  assert.ok(!isWorksMail("a@gmail.com"))
  assert.ok(!isWorksMail(null))
})

test("메일 본문 — 코드 · 10분 · 옴니스", () => {
  const m = codeMail("123456")
  assert.match(m.text, /123456/)
  assert.match(m.text, /10분/)
  assert.match(m.subject, /옴니스/)
})
