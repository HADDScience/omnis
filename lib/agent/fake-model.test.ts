/** 시험 모델 — 켜지는 조건 · 되받는 답. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"

import { fakeAgentEnabled, fakeAnswer, lastUserText } from "./fake-model"

test("OMNIS_AGENT_FAKE=1 일 때만 켜지고 운영 배포에서는 켜지지 않는다", () => {
  assert.equal(fakeAgentEnabled({}), false)
  assert.equal(fakeAgentEnabled({ OMNIS_AGENT_FAKE: "1" }), true)
  assert.equal(fakeAgentEnabled({ OMNIS_AGENT_FAKE: "1", VERCEL_ENV: "preview" }), true)
  assert.equal(fakeAgentEnabled({ OMNIS_AGENT_FAKE: "1", VERCEL_ENV: "production" }), false)
  assert.equal(fakeAgentEnabled({ OMNIS_AGENT_FAKE: "true" }), false)
})

test("마지막 사용자 글을 되받는다", () => {
  const prompt = [
    { role: "system" as const, content: "규칙" },
    { role: "user" as const, content: [{ type: "text" as const, text: "앞 질문" }] },
    { role: "assistant" as const, content: [{ type: "text" as const, text: "앞 답" }] },
    { role: "user" as const, content: [{ type: "text" as const, text: "이번 질문" }] },
  ]
  assert.equal(lastUserText(prompt), "이번 질문")
  assert.match(fakeAnswer("이번 질문"), /^시험 답입니다 — 「이번 질문」/)
})
