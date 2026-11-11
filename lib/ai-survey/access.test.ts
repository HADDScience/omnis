import { test } from "node:test"
import assert from "node:assert/strict"
import { surveyAllowList, surveyAllowed } from "./access"

const env = (v?: string) => ({ AI_SURVEY_ALLOW_USER_IDS: v })

test("값이 없으면 아무에게도 열지 않는다 — 설정을 빠뜨린 배포가 전원에게 열리지 않는다", () => {
  assert.equal(surveyAllowed("u1", {}), false)
  assert.equal(surveyAllowed("u1", env("")), false)
  assert.equal(surveyAllowed("u1", env("  ,  ")), false)
})

test("목록에 있는 계정만 — 쉼표 · 공백 · 줄바꿈으로 나눈다", () => {
  const e = env(" u1, u2\nu3 ")
  assert.equal(surveyAllowed("u1", e), true)
  assert.equal(surveyAllowed("u2", e), true)
  assert.equal(surveyAllowed("u3", e), true)
  assert.deepEqual([...surveyAllowList(e).ids], ["u1", "u2", "u3"])
})

test("거부 — 목록 밖 계정 · 로그인 안 함 · 일부만 같은 id · 대소문자가 다른 id", () => {
  const e = env("user-abc,u2")
  assert.equal(surveyAllowed("u9", e), false)
  assert.equal(surveyAllowed(null, e), false)
  assert.equal(surveyAllowed(undefined, e), false)
  assert.equal(surveyAllowed("", e), false)
  assert.equal(surveyAllowed("user-ab", e), false)
  assert.equal(surveyAllowed("user-abcd", e), false)
  assert.equal(surveyAllowed("USER-ABC", e), false)
  // id 자리에 목록 전체를 넣어도 통하지 않는다
  assert.equal(surveyAllowed("user-abc,u2", e), false)
})

test("「*」 는 전원 — 그래도 로그인하지 않았으면 닫힌다", () => {
  assert.equal(surveyAllowed("anyone", env("*")), true)
  assert.equal(surveyAllowed("anyone", env("u1, *")), true)
  assert.equal(surveyAllowed(null, env("*")), false)
  // 「*」 는 id 가 아니다
  assert.equal(surveyAllowList(env("*")).ids.size, 0)
})
