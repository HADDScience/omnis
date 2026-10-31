/** 다시 보내기 중복 막기. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"

import { decideClientId, isUniqueViolation } from "./chat-client-id"

const me = { userId: "u1", roomId: "r1" }

test("처음 보는 clientId 는 새로 저장한다", () => {
  assert.equal(decideClientId(null, me), "new")
})

test("내가 같은 방에 이미 저장한 글이면 그 글을 돌려준다", () => {
  assert.equal(decideClientId({ authorId: "u1", roomId: "r1" }, me), "replay")
})

test("거부 — 남의 글 clientId 로는 그 글을 받아 가지 못한다", () => {
  assert.equal(decideClientId({ authorId: "u2", roomId: "r1" }, me), "conflict")
})

test("거부 — 내 글이라도 다른 방 글이면 돌려주지 않는다", () => {
  assert.equal(decideClientId({ authorId: "u1", roomId: "r2" }, me), "conflict")
})

test("P2002 만 고유 제약 위반으로 본다", () => {
  assert.equal(isUniqueViolation({ code: "P2002" }), true)
  assert.equal(isUniqueViolation({ code: "P2025" }), false)
  assert.equal(isUniqueViolation(new Error("x")), false)
  assert.equal(isUniqueViolation(null), false)
})
