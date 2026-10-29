/** 실행당 상한 · 요금 · 모델 설정. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"

import { limitReason, spentWith, usageOf } from "./limits"
import { costOf, KRW_PER_USD } from "../ai-pricing"
import { agentLimits, modelFor, modelKey } from "../ai-models"

const SOL = "openai:gpt-6.1-sol"

test("요금 — gpt-6.1-sol $2.00 / 캐시 $0.10 / 출력 $10.00", () => {
  // 로컬 첫 실행(2026-10-29)의 두 호출: 입력 5179 · 캐시 0 · 출력 23 / 입력 5709 · 캐시 5176 · 출력 16
  const a = costOf(SOL, { inputTokens: 5179, cachedInputTokens: 0, outputTokens: 23 })
  assert.ok(Math.abs(a.krw - ((5179 * 2 + 23 * 10) / 1e6) * KRW_PER_USD) < 1e-9)
  assert.ok(Math.abs(a.krw - 14.6114) < 0.001)
  const b = costOf(SOL, { inputTokens: 5709, cachedInputTokens: 5176, outputTokens: 16 })
  assert.ok(Math.abs(b.krw - 2.4062) < 0.001)
})

test("요금표에 없는 모델은 0 으로 두고 priced=false", () => {
  assert.deepEqual(costOf("openai:gpt-9", { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 1000 }), { usd: 0, krw: 0, priced: false })
})

test("usage 의 모르는 칸은 0", () => {
  assert.deepEqual(usageOf(undefined), { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 })
  assert.deepEqual(usageOf({ inputTokens: 10, outputTokens: 2, inputTokenDetails: { cacheReadTokens: 4 }, outputTokenDetails: { reasoningTokens: 1 } }), {
    inputTokens: 10, cachedInputTokens: 4, outputTokens: 2, reasoningTokens: 1,
  })
})

const limits = { maxTurns: 12, maxKrw: 200 }
const step = (input: number, output: number) => ({ inputTokens: input, cachedInputTokens: 0, outputTokens: output, reasoningTokens: 0 })

test("상한 — 턴 12회에 닿으면 멈춘다", () => {
  assert.equal(limitReason(spentWith({ turns: 0, krw: 0 }, SOL, Array(11).fill(step(100, 10))), limits), null)
  assert.match(limitReason(spentWith({ turns: 0, krw: 0 }, SOL, Array(12).fill(step(100, 10))), limits) ?? "", /턴 상한/)
})

test("상한 — 확인 뒤 이어 간 구간도 앞 구간의 턴을 더해 센다", () => {
  assert.match(limitReason(spentWith({ turns: 10, krw: 0 }, SOL, [step(100, 10), step(100, 10)]), limits) ?? "", /턴 상한/)
})

test("상한 — 200원에 닿으면 멈춘다", () => {
  // 입력 7만 토큰 한 번 = 0.14달러 = 193.2원 → 아직. 한 번 더면 넘는다
  const big = step(70_000, 0)
  assert.equal(limitReason(spentWith({ turns: 0, krw: 0 }, SOL, [big]), limits), null)
  assert.match(limitReason(spentWith({ turns: 0, krw: 0 }, SOL, [big, step(5_000, 0)]), limits) ?? "", /비용 상한/)
  assert.match(limitReason({ turns: 1, krw: 199.9 + 0.2 }, limits) ?? "", /비용 상한/)
})

test("모델 설정 — 기본은 gpt-6.1-sol · medium, 환경변수로 바꾼다", () => {
  assert.deepEqual(modelFor("agent", {}), { vendor: "openai", model: "gpt-6.1-sol", reasoning: "medium" })
  assert.equal(modelKey(modelFor("agent", { OMNIS_AGENT_MODEL: "anthropic:claude-sonnet-5-5" })), "anthropic:claude-sonnet-5-5")
  assert.equal(modelFor("agent", { OMNIS_AGENT_REASONING: "high" }).reasoning, "high")
  assert.throws(() => modelFor("agent", { OMNIS_AGENT_MODEL: "gpt-6.1-sol" }), /vendor:model/)
  assert.throws(() => modelFor("agent", { OMNIS_AGENT_MODEL: "azure:gpt" }), /vendor:model/)
  assert.deepEqual(agentLimits({}), { maxTurns: 12, maxKrw: 200 })
  assert.deepEqual(agentLimits({ OMNIS_AGENT_MAX_TURNS: "6", OMNIS_AGENT_MAX_KRW: "50" }), { maxTurns: 6, maxKrw: 50 })
})
