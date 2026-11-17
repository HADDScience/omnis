/** 시험 모델 — 켜지는 조건 · 되받는 답. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"

import { fakeAgentEnabled, fakeAnswer, lastUserText, scriptedToolCall } from "./fake-model"

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

test("시험 도구 부르기 — 사용자 글에 처음 답할 때만, 입력이 JSON 일 때만", () => {
  const user = (text: string) => ({ role: "user" as const, content: [{ type: "text" as const, text }] })
  const ask = '샘플 남겨 줘 [[record_sample {"org":"시험기관","product":"시험젤 2ml","quantity":3}]]'
  assert.deepEqual(scriptedToolCall([user(ask)] as never), { toolName: "record_sample", input: '{"org":"시험기관","product":"시험젤 2ml","quantity":3}' })
  assert.equal(scriptedToolCall([user("그냥 질문")] as never), null)
  assert.equal(scriptedToolCall([user("[[record_sample {깨진}]]")] as never), null)
  // 도구 결과 뒤에는 부르지 않는다 — 끝없이 부르지 않게
  const afterTool = [user(ask), { role: "tool", content: [] }]
  assert.equal(scriptedToolCall(afterTool as never), null)
})
