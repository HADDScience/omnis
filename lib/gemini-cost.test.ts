import { test } from "node:test"
import assert from "node:assert/strict"
import { geminiAiUsageRow } from "./gemini-usage"
import { MODEL_PRICES } from "./ai-pricing"
import { parseRecipients } from "./notify-recipients"

test("Gemini 호출도 원으로 남는다 — 출력은 생각 토큰 포함(total − prompt)", () => {
  const r = geminiAiUsageRow({ endpoint: "rebuildTask", promptTokens: 1_000_000, candidateTokens: 100_000, totalTokens: 1_300_000, model: "gemini-3.5-flash-lite", userId: "u" })
  assert.equal(r.vendor, "google")
  assert.equal(r.feature, "rebuildTask")
  assert.equal(r.outputTokens, 300_000)
  assert.equal(r.reasoningTokens, 200_000)
  // 0.30 + 0.3 × 2.50 = 1.05 USD
  assert.ok(Math.abs(r.costUsd - 1.05) < 1e-9)
  assert.ok(r.costKrw > 0)
})

test("운영에서 부르는 Gemini 모델은 모두 요금표에 있다(없으면 0원으로 남아 상한이 새어 나간다)", () => {
  for (const m of ["gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-embedding-001"]) assert.ok(MODEL_PRICES[`google:${m}`], m)
})

test("임베딩은 출력 없이 입력만", () => {
  const r = geminiAiUsageRow({ endpoint: "embedTexts.RETRIEVAL_QUERY", promptTokens: 1000, candidateTokens: 0, totalTokens: 1000, model: "gemini-embedding-001" })
  assert.equal(r.outputTokens, 0)
  assert.ok(r.costKrw > 0)
  assert.equal(r.userId, null)
})

test("알림 받는 사람 설정 — 모양이 틀리면 빈 목록(예전 동작)", () => {
  assert.deepEqual(parseRecipients(null), [])
  assert.deepEqual(parseRecipients({ userIds: ["a", "a", "", 3, "b"] }), ["a", "b"])
  assert.deepEqual(parseRecipients({ userIds: "a" }), [])
})
