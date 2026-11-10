import { test } from "node:test"
import assert from "node:assert/strict"
import { passwordProblem, PASSWORD_MIN } from "./password-policy"

test("짧은 비밀번호는 받지 않는다", () => {
  assert.notEqual(passwordProblem("ab".repeat(PASSWORD_MIN).slice(0, PASSWORD_MIN - 1)), null)
  assert.equal(passwordProblem("correct horse"), null)
})

test("같은 글자 반복은 받지 않는다", () => {
  assert.notEqual(passwordProblem("aaaaaaaaaaaa"), null)
})

test("지금 비밀번호와 같으면 받지 않는다", () => {
  assert.notEqual(passwordProblem("correct horse", "correct horse"), null)
  assert.equal(passwordProblem("correct horse", "battery staple"), null)
})

test("72바이트를 넘으면 받지 않는다", () => {
  assert.notEqual(passwordProblem("가나".repeat(12) + "다"), null) // 75바이트
  assert.equal(passwordProblem("가나".repeat(12)), null) // 72바이트
})
