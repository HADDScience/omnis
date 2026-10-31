/** 채팅 목록 따라가기. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"

import { arrivals, followOnAppend, unseenLabel } from "./chat-follow"

const m = (id: string, author = "u2") => ({ id, author: { id: author } })
const isMine = (r: { author: { id: string } }) => r.author.id === "me"

const ids = (...xs: string[]) => new Set(xs)

test("직전 목록 뒤로 새로 붙은 글만 센다", () => {
  assert.deepEqual(arrivals(ids("a", "b"), [m("a"), m("b"), m("c"), m("d")])?.map((r) => r.id), ["c", "d"])
})

test("보내는 중 말풍선이 끝에 있어도 그 앞에 끼워진 남의 글을 센다", () => {
  const next = [m("a"), m("c"), m("temp-1", "me")]
  assert.deepEqual(arrivals(ids("a", "temp-1"), next)?.map((r) => r.id), ["c"])
})

test("거부 — 앞에 붙은 옛 글은 새 글로 세지 않는다", () => {
  assert.deepEqual(arrivals(ids("a", "b"), [m("y"), m("z"), m("a"), m("b")]), [])
})

test("고친 글 갈아 끼우기는 빈 배열", () => {
  assert.deepEqual(arrivals(ids("a", "b"), [m("a"), m("b")]), [])
})

test("처음 그림 · 목록을 갈아 끼움은 null", () => {
  assert.equal(arrivals(null, [m("a")]), null)
  assert.equal(arrivals(ids("gone"), [m("a")]), null)
})

test("맨 아래에 있으면 따라간다", () => {
  assert.deepEqual(followOnAppend([m("c")], true, isMine), { follow: true, unseen: 0 })
})

test("내가 보낸 글이면 위에 있어도 따라간다", () => {
  assert.deepEqual(followOnAppend([m("c"), m("temp-1", "me")], false, isMine), { follow: true, unseen: 0 })
})

test("거부 — 위로 올려 읽는 중에 남의 글이 오면 따라가지 않고 센다", () => {
  assert.deepEqual(followOnAppend([m("c"), m("d")], false, isMine), { follow: false, unseen: 2 })
})

test("거부 — 붙은 글이 없으면 아무것도 하지 않는다(남이 고친 글 갈아 끼우기)", () => {
  assert.deepEqual(followOnAppend([], true, isMine), { follow: false, unseen: 0 })
})

test("알약 문구", () => {
  assert.equal(unseenLabel(3), "새 메시지 3개")
  assert.equal(unseenLabel(120), "새 메시지 99+개")
})
