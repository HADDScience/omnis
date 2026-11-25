/**
 * 채팅 글 고치기 규칙(2026-11-17). 실행: pnpm test:unit
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { editedLabel, isKakaoMessage, messageChangeRefusal } from "./message-edit"

const mine = { authorId: "u1", kind: "NORMAL", content: "회의는 3시", deletedAt: null, sourceId: null }

test("내가 쓴 보통 글은 고치고 지울 수 있다", () => {
  assert.equal(messageChangeRefusal(mine, "u1", "edit"), null)
  assert.equal(messageChangeRefusal(mine, "u1", "delete"), null)
})

test("남의 글 · 옴니스 글 · 지운 글은 고치지 못한다", () => {
  assert.match(messageChangeRefusal(mine, "u2", "edit") ?? "", /내가 쓴 글만/)
  assert.match(messageChangeRefusal({ ...mine, kind: "TASK_REBUILT" }, "u1", "edit") ?? "", /옴니스/)
  assert.match(messageChangeRefusal({ ...mine, content: "🤖 #a 재구성" }, "u1", "edit") ?? "", /옴니스/)
  assert.match(messageChangeRefusal({ ...mine, content: "__TASK_CREATED__:x" }, "u1", "edit") ?? "", /업무 카드/)
  assert.match(messageChangeRefusal({ ...mine, deletedAt: new Date() }, "u1", "edit") ?? "", /이미 지운/)
})

test("카톡에서 옮겨 온 글은 고치지 못하지만 지우기는 그대로다", () => {
  const kakao = { ...mine, sourceId: "kakao:0123abcd" }
  assert.equal(isKakaoMessage(kakao), true)
  assert.match(messageChangeRefusal(kakao, "u1", "edit") ?? "", /카톡/)
  assert.equal(messageChangeRefusal(kakao, "u1", "delete"), null)
  // 다른 출처 표식은 카톡이 아니다
  assert.equal(isKakaoMessage({ sourceId: "mail:1" }), false)
  assert.equal(isKakaoMessage({}), false)
})

test("「수정됨」 시각 — 같은 날이면 시각만, 다른 날이면 날짜까지", () => {
  const sent = new Date(2026, 10, 17, 9, 5)
  assert.equal(editedLabel(sent, new Date(2026, 10, 17, 18, 30)), "수정됨 오후 6:30")
  assert.equal(editedLabel(sent, new Date(2026, 10, 18, 0, 7)), "수정됨 11월 18일 오전 12:07")
})
