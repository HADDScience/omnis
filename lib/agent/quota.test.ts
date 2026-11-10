/**
 * 데모 비용 방어 — 하루 상한. 실행: pnpm test:unit
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { agentQuota, DEMO_DAILY_MESSAGE, kstDayStart, quotaEnabled, quotaRefusal } from "./quota"

const demoEnv = { OMNIS_AGENT_DAILY_KRW: "300", OMNIS_AGENT_USER_DAILY_RUNS: "20" }

test("기본값(운영) — 환경변수가 없으면 상한이 없고 DB 를 읽지 않는다", () => {
  const q = agentQuota({})
  assert.deepEqual(q, { dailyKrw: null, userDailyRuns: null })
  assert.equal(quotaEnabled(q), false)
  // 아무리 많이 써도 막지 않는다
  assert.equal(quotaRefusal({ usedKrw: 1_000_000, userRuns: 10_000 }, q, false), null)
})

test("잘못된 값 · 0 · 음수는 상한 없음으로 본다 — 오타로 운영이 막히지 않게", () => {
  assert.deepEqual(agentQuota({ OMNIS_AGENT_DAILY_KRW: "abc", OMNIS_AGENT_USER_DAILY_RUNS: "0" }), { dailyKrw: null, userDailyRuns: null })
  assert.deepEqual(agentQuota({ OMNIS_AGENT_DAILY_KRW: "-5", OMNIS_AGENT_USER_DAILY_RUNS: " " }), { dailyKrw: null, userDailyRuns: null })
  assert.deepEqual(agentQuota({ OMNIS_AGENT_USER_DAILY_RUNS: "20.7" }).userDailyRuns, 20)
})

test("하루 전체 상한에 닿으면 429 와 데모 문구 (거부되어야 하는 경우)", () => {
  const q = agentQuota(demoEnv)
  assert.equal(quotaRefusal({ usedKrw: 299.9, userRuns: 0 }, q, true), null, "닿기 전에는 받는다")
  const r = quotaRefusal({ usedKrw: 300, userRuns: 0 }, q, true)
  assert.equal(r?.status, 429)
  assert.equal(r?.reason, "daily_krw")
  assert.equal(r?.error, DEMO_DAILY_MESSAGE)
  assert.equal(r?.error, "오늘 데모 사용량을 다 썼어요. 내일 다시 써 주세요")
})

test("데모가 아닌 곳에서 상한을 켜면 「데모」 라고 말하지 않는다", () => {
  const r = quotaRefusal({ usedKrw: 500, userRuns: 0 }, agentQuota(demoEnv), false)
  assert.equal(r?.status, 429)
  assert.doesNotMatch(r!.error, /데모/)
})

test("사람당 하루 실행 수에 닿으면 429 (거부되어야 하는 경우)", () => {
  const q = agentQuota(demoEnv)
  assert.equal(quotaRefusal({ usedKrw: 0, userRuns: 19 }, q, true), null)
  const r = quotaRefusal({ usedKrw: 0, userRuns: 20 }, q, true)
  assert.equal(r?.status, 429)
  assert.equal(r?.reason, "user_runs")
  assert.match(r!.error, /20회/)
})

test("하나만 켜도 그것만 본다", () => {
  const onlyRuns = agentQuota({ OMNIS_AGENT_USER_DAILY_RUNS: "3" })
  assert.equal(quotaEnabled(onlyRuns), true)
  assert.equal(quotaRefusal({ usedKrw: 99_999, userRuns: 2 }, onlyRuns, true), null, "원 상한은 꺼져 있다")
  const onlyKrw = agentQuota({ OMNIS_AGENT_DAILY_KRW: "100" })
  assert.equal(quotaRefusal({ usedKrw: 10, userRuns: 99_999 }, onlyKrw, true), null, "실행 수 상한은 꺼져 있다")
})

test("「오늘」 은 한국 시각 0시부터", () => {
  // KST 2026-10-29 08:59 = UTC 10-28 23:59 → 오늘 0시는 UTC 10-28 15:00
  assert.equal(kstDayStart(new Date("2026-10-28T23:59:00Z")).toISOString(), "2026-10-28T15:00:00.000Z")
  // KST 2026-10-29 00:00 정각 = UTC 10-28 15:00 → 그 시각 자신
  assert.equal(kstDayStart(new Date("2026-10-28T15:00:00Z")).toISOString(), "2026-10-28T15:00:00.000Z")
  // KST 2026-10-28 23:59 = UTC 10-28 14:59 → 전날 0시
  assert.equal(kstDayStart(new Date("2026-10-28T14:59:00Z")).toISOString(), "2026-10-27T15:00:00.000Z")
})
