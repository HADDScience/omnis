/** 「답을 받지 못했어요」 를 띄울지 — 2026-10-29 제보 재현. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"

import { answeredAfter, showPendingBubble, unansweredQuestion } from "./room-view"

const q = { id: "q1", fromOmnis: false, createdAt: "2026-10-29T05:01:03.829Z" }
const a = { id: "a1", fromOmnis: true, createdAt: "2026-10-29T05:01:15.019Z" }

test("재현 — 새로고침 직후(서버 실행 RUNNING · 스트림 아직 안 붙음)에는 답을 못 받은 것이 아니다", () => {
  // 예전 판정(busy 만 봄)이면 q 를 돌려줘 「다시 묻기」 가 떴다
  assert.equal(unansweredQuestion({ messages: [q], cards: [], busy: false, running: true }), null)
})

test("재현 — 연결이 끊겨 스트림이 오류로 끝나도 서버가 돌고 있으면 답을 못 받은 것이 아니다", () => {
  assert.equal(unansweredQuestion({ messages: [q], cards: [], busy: false, running: true }), null)
})

test("실행이 끝났는데 마지막이 내 글이면 답을 못 받은 것이다 (거부되어야 하는 경우가 아니라 보여야 하는 경우)", () => {
  assert.equal(unansweredQuestion({ messages: [q], cards: [], busy: false, running: false }), q)
})

test("답이 붙었으면 아니다", () => {
  assert.equal(unansweredQuestion({ messages: [q, a], cards: [], busy: false, running: false }), null)
})

test("스트림을 읽는 중이면 아니다", () => {
  assert.equal(unansweredQuestion({ messages: [q], cards: [], busy: true, running: false }), null)
})

test("확인 카드가 답이면 아니다 — 기다리는 카드 · 내 글 뒤의 카드", () => {
  assert.equal(unansweredQuestion({ messages: [q], cards: [{ status: "PENDING", createdAt: "2026-10-29T05:01:00Z" }], busy: false, running: false }), null)
  assert.equal(unansweredQuestion({ messages: [q], cards: [{ status: "REJECTED", createdAt: "2026-10-29T05:01:09Z" }], busy: false, running: false }), null)
})

test("내 글보다 앞의 끝난 카드는 이번 질문의 답이 아니다", () => {
  assert.equal(unansweredQuestion({ messages: [q], cards: [{ status: "EXECUTED", createdAt: "2026-10-29T04:00:00Z" }], busy: false, running: false }), q)
})

test("스트림이 오류로 끝나도 질문 뒤에 답이 남았으면 답을 받은 것", () => {
  assert.equal(answeredAfter([q, a], "q1"), true)
  assert.equal(answeredAfter([q], "q1"), false)
  assert.equal(answeredAfter([a, q], "q1"), false)
  assert.equal(answeredAfter([q, a], null), false)
})

test("보내는 중인 글 — 질문 id 로 대조한다. 같은 내용의 앞 글이 있어도 새 글은 따로 보인다", () => {
  const same = { id: "q0", fromOmnis: false, createdAt: "2026-10-29T04:00:00Z" }
  assert.equal(showPendingBubble([same], { questionId: "q1" }), true)
  assert.equal(showPendingBubble([same, q], { questionId: "q1" }), false)
  assert.equal(showPendingBubble([], { questionId: null }), true)
  assert.equal(showPendingBubble([q], null), false)
})
