/** 옴니스 1:1 방 문맥. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"

import { buildOmnisHistory, HISTORY_MAX_CHARS, HISTORY_MAX_MESSAGES, HISTORY_MESSAGE_MAX_CHARS } from "./omnis-history"

const q = (content: string) => ({ fromOmnis: false, content })
const a = (content: string) => ({ fromOmnis: true, content })

test("빈 방은 빈 문맥", () => {
  assert.deepEqual(buildOmnisHistory([]), [])
})

test("질문 · 답 왕복을 그대로 옮긴다", () => {
  assert.deepEqual(buildOmnisHistory([q("지연 업무 알려줘"), a("3건입니다.")]), [
    { role: "user", text: "지연 업무 알려줘" },
    { role: "model", text: "3건입니다." },
  ])
})

test("답의 각주 번호는 지운다 — 그때의 검색 결과를 가리킨다", () => {
  const [, model] = buildOmnisHistory([q("견적?"), a("A사 견적은 120만 원입니다 [1, 3]. 발송은 끝났습니다 [2].")])
  assert.equal(model.text, "A사 견적은 120만 원입니다. 발송은 끝났습니다.")
})

test("답을 못 받은 질문은 빼서 user 가 두 번 이어지지 않는다 (거부되어야 하는 경우)", () => {
  const turns = buildOmnisHistory([q("첫 질문"), a("첫 답"), q("실패한 질문")])
  assert.equal(turns.at(-1)?.role, "model")
  assert.equal(turns.length, 2)
})

test("같은 쪽 글이 이어지면 한 턴으로 합친다", () => {
  const turns = buildOmnisHistory([q("하나"), q("둘"), a("답")])
  assert.deepEqual(turns, [
    { role: "user", text: "하나\n\n둘" },
    { role: "model", text: "답" },
  ])
})

test("옴니스 글로 시작하면 버린다 — 문맥은 user 로 시작한다", () => {
  const turns = buildOmnisHistory([a("고아 답"), q("질문"), a("답")])
  assert.equal(turns[0].role, "user")
  assert.equal(turns.length, 2)
})

test(`최근 ${HISTORY_MAX_MESSAGES}개 글만`, () => {
  const many = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? q(`질문 ${i}`) : a(`답 ${i}`)))
  const turns = buildOmnisHistory(many)
  assert.equal(turns.length, HISTORY_MAX_MESSAGES)
  assert.equal(turns[0].text, "질문 10")
})

test("글 하나가 길면 앞부분만", () => {
  const [, model] = buildOmnisHistory([q("표 줘"), a("가".repeat(HISTORY_MESSAGE_MAX_CHARS + 500))])
  assert.ok(model.text.length < HISTORY_MESSAGE_MAX_CHARS + 20)
  assert.ok(model.text.endsWith("…(이하 생략)"))
})

test("전체 상한을 넘으면 오래된 왕복부터 버리고 순서는 유지", () => {
  const big = "나".repeat(2_500)
  const msgs = Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? q(`질문${i} ${big}`) : a(`답${i} ${big}`)))
  const turns = buildOmnisHistory(msgs)
  const total = turns.reduce((n, t) => n + t.text.length, 0)
  assert.ok(total <= HISTORY_MAX_CHARS, `total ${total}`)
  assert.equal(turns[0].role, "user")
  assert.equal(turns.at(-1)?.role, "model")
  assert.ok(turns.at(-1)!.text.startsWith("답11"))
  turns.forEach((t, i) => i > 0 && assert.notEqual(t.role, turns[i - 1].role))
})
