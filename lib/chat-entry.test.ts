/** 방 입장 — loading 입력창에서 방 화면 입력창으로 넘기는 글. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"

import { QUEUED_FRESH_MS, peekHandoff, resolveHandoff, roomFromList, takeHandoff, writeHandoff } from "./chat-entry"
import type { RoomList, RoomListItem } from "./chat-rooms"

const base = { text: "", caret: 0, focused: false, queued: null, queuedAt: 0 }

test("넘긴 글은 한 번만 꺼낸다 — 두 번째는 없다 (거부되어야 하는 경우: 다른 방 키)", () => {
  writeHandoff("room:a", { text: "안녕", caret: 2 })
  writeHandoff("room:a", { focused: true })
  assert.equal(peekHandoff("room:b"), null)
  assert.deepEqual(takeHandoff("room:a"), { ...base, text: "안녕", caret: 2, focused: true })
  assert.equal(takeHandoff("room:a"), null)
})

test("보내기 대기 글 — 방금 누른 것은 보내고, 오래된 것은 보내지 않고 입력칸에 되돌린다", () => {
  const now = 1_000_000
  assert.deepEqual(resolveHandoff({ ...base, text: "쓰던 글" }, now), { send: null, text: "쓰던 글" })
  assert.deepEqual(resolveHandoff({ ...base, queued: "보낼 글", queuedAt: now - 1000 }, now), { send: "보낼 글", text: "" })
  // 경계: 정확히 30초는 보낸다, 그 뒤는 거부
  assert.equal(resolveHandoff({ ...base, queued: "x", queuedAt: now - QUEUED_FRESH_MS }, now).send, "x")
  assert.deepEqual(resolveHandoff({ ...base, queued: "보낼 글", queuedAt: now - QUEUED_FRESH_MS - 1, text: "더 쓴 글" }, now), {
    send: null,
    text: "보낼 글\n더 쓴 글",
  })
  assert.deepEqual(resolveHandoff({ ...base, queued: "보낼 글", queuedAt: 0 }, now), { send: null, text: "보낼 글" })
})

test("방 머리 — 목록에서 방 키로 찾는다 (거부되어야 하는 경우: 없는 키 · 목록 없음)", () => {
  const row = (key: string, kind: RoomListItem["kind"]): RoomListItem => ({
    id: key.split(":")[1], key, kind, name: key, lastAt: "2026-10-30T00:00:00.000Z", preview: null, unread: 0, favorite: false, muted: false,
  })
  const list = { omnis: [row("room:o", "OMNIS_DM")], company: [row("room:c", "COMPANY")], tasks: [row("task:t", "TASK")], groups: [], folders: [] } as unknown as RoomList
  assert.equal(roomFromList(list, "task:t")?.kind, "TASK")
  assert.equal(roomFromList(list, "room:c")?.kind, "COMPANY")
  assert.equal(roomFromList(list, "room:없음"), null)
  assert.equal(roomFromList(null, "room:o"), null)
})
