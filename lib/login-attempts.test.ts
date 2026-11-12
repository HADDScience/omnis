import assert from "node:assert/strict"
import { test } from "node:test"
import { attemptInfo, encodeAttemptCode, loginFailMessage, normalizeLoginName, parseAttemptCode, seoulClock } from "./login-attempts"

const LIMITS = { account: { max: 5, windowMs: 15 * 60_000 }, ip: { max: 30, windowMs: 15 * 60_000 } }
// 2026-11-12 16:07:02 KST
const T0 = Date.UTC(2026, 10, 12, 7, 7, 2)

test("이름은 앞뒤 공백 · 자모 분리를 정리한다", () => {
  const nfd = "정우창".normalize("NFD")
  assert.notEqual(nfd, "정우창")
  assert.equal(normalizeLoginName(` ${nfd}\t`), "정우창")
})

test("두 번 틀리면 3번 남고, 첫 실패가 창을 벗어날 때 풀린다", () => {
  const info = attemptInfo({ accountFails: [T0 + 13_000, T0], ipFails: [T0, T0 + 13_000], now: T0 + 14_000, limits: LIMITS })
  assert.deepEqual(info, { locked: false, fails: 2, remaining: 3, lockUntil: T0 + 15 * 60_000 })
  assert.equal(loginFailMessage(encodeAttemptCode(info)), "이름 또는 비밀번호가 올바르지 않습니다. 실패 2회 · 3번 더 틀리면 16:23까지 잠깁니다")
})

test("다섯 번째 실패면 잠기고, 최근 다섯 번째가 벗어날 때 풀린다", () => {
  const fails = [0, 1, 2, 3, 4, 5].map((i) => T0 + i * 60_000)
  const info = attemptInfo({ accountFails: fails, ipFails: [], now: T0 + 6 * 60_000, limits: LIMITS })
  assert.deepEqual(info, { locked: true, reason: "account", until: T0 + 60_000 + 15 * 60_000 })
  assert.equal(loginFailMessage(encodeAttemptCode(info)), "로그인 시도가 너무 많아 16:24까지 잠겼습니다.")
})

test("IP 한도로 잠기면 IP 기준 시각을 낸다", () => {
  const ip = Array.from({ length: 30 }, (_, i) => T0 + i * 1000)
  const info = attemptInfo({ accountFails: [T0], ipFails: ip, now: T0 + 40_000, limits: LIMITS })
  assert.deepEqual(info, { locked: true, reason: "ip", until: T0 + 15 * 60_000 })
})

test("서울 시각은 초가 남으면 올린다", () => {
  assert.equal(seoulClock(Date.UTC(2026, 10, 12, 7, 22, 0)), "16:22")
  assert.equal(seoulClock(Date.UTC(2026, 10, 12, 7, 22, 2)), "16:23")
  assert.equal(seoulClock(Date.UTC(2026, 10, 12, 14, 59, 30)), "00:00")
})

test("알 수 없는 code 는 예전 문구로", () => {
  assert.deepEqual(parseAttemptCode("credentials"), { kind: "unknown" })
  assert.deepEqual(parseAttemptCode("fail.x.3.1"), { kind: "unknown" })
  assert.deepEqual(parseAttemptCode("locked"), { kind: "locked", until: null })
  assert.equal(loginFailMessage(undefined), "이름 또는 비밀번호가 올바르지 않습니다.")
  assert.match(loginFailMessage("locked"), /^로그인 시도가 너무 많아 잠시 막혔습니다/)
})
