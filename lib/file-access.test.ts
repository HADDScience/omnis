/**
 * 첨부 파일 접근 판정(옴니스 방 · 사람끼리 방). 실행: pnpm test:unit
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { ATTACH_MAX, canSeeFile, checkAttachable, PUBLIC_FILE_WHERE, visibleFileWhere } from "./file-access"

const publicFile = { privateToUserId: null, messageId: "m1", roomMemberIds: [] }

test("전사방 · 업무 첨부(privateToUserId 없음)는 구성원 누구나 — 예전 그대로", () => {
  assert.equal(canSeeFile(publicFile, "a"), true)
  assert.equal(canSeeFile({ privateToUserId: null, messageId: null, roomMemberIds: null }, "c"), true)
})

test("옴니스 방에 붙이려고 올린 파일 — 붙기 전에는 올린 사람만", () => {
  const f = { privateToUserId: "a", messageId: null, roomMemberIds: null }
  assert.equal(canSeeFile(f, "a"), true)
  assert.equal(canSeeFile(f, "b"), false) // 거부되어야 하는 경우
})

test("옴니스 1:1 방 질문에 붙은 파일 — 방 주인만", () => {
  const f = { privateToUserId: "a", messageId: "q1", roomMemberIds: ["a"] }
  assert.equal(canSeeFile(f, "a"), true)
  assert.equal(canSeeFile(f, "b"), false) // 거부되어야 하는 경우
})

test("A · B 의 방에 붙은 파일 — B 는 보고, 방 밖 C 는 못 본다", () => {
  const f = { privateToUserId: "a", messageId: "m2", roomMemberIds: ["a", "b"] }
  assert.equal(canSeeFile(f, "a"), true)
  assert.equal(canSeeFile(f, "b"), true)
  assert.equal(canSeeFile(f, "c"), false) // 거부되어야 하는 경우
})

test("방을 나간 사람은 더 못 본다 — 올린 사람이 나가도 같다", () => {
  // B 가 나갔다(참여자 행이 지워진다)
  assert.equal(canSeeFile({ privateToUserId: "a", messageId: "m2", roomMemberIds: ["a"] }, "b"), false)
  // 올린 A 가 나갔다 — 올린 사람이라도 방 밖이면 못 본다
  assert.equal(canSeeFile({ privateToUserId: "a", messageId: "m2", roomMemberIds: ["b"] }, "a"), false)
})

test("초대받은 사람은 이전 첨부도 본다(이전 대화를 보는 기존 규칙과 같다)", () => {
  assert.equal(canSeeFile({ privateToUserId: "a", messageId: "m2", roomMemberIds: ["a", "b", "c"] }, "c"), true)
})

test("목록 where 도 같은 세 갈래 — 공개 · 내가 올린 안 붙은 것 · 내가 참여자인 방의 것", () => {
  assert.deepEqual(visibleFileWhere("c"), {
    OR: [
      { privateToUserId: null },
      { privateToUserId: "c", messageId: null },
      { privateToUserId: { not: null }, message: { room: { members: { some: { userId: "c" } } } } },
    ],
  })
  assert.deepEqual(PUBLIC_FILE_WHERE, { privateToUserId: null })
})

const row = (id: string, privateToUserId: string | null, messageId: string | null = null, taskId: string | null = null) => ({ id, privateToUserId, messageId, taskId })

test("붙이기 — 내가 올린 · 아직 안 붙은 파일만", () => {
  assert.deepEqual(checkAttachable(["f1", "f2"], [row("f1", "a"), row("f2", "a")], "a"), { ok: true })
  assert.deepEqual(checkAttachable([], [], "a"), { ok: true })
})

test("붙이기 거부 — 없는 파일 · 남의 파일 · 공개 파일은 같은 404(있다는 것도 새지 않게)", () => {
  const missing = checkAttachable(["nope"], [], "a")
  const others = checkAttachable(["f1"], [row("f1", "b")], "a")
  const pub = checkAttachable(["f1"], [row("f1", null)], "a")
  for (const r of [missing, others, pub]) {
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.status, 404)
  }
  assert.deepEqual(others, missing)
})

test("붙이기 거부 — 이미 다른 글 · 업무에 붙은 파일은 409", () => {
  const onMessage = checkAttachable(["f1"], [row("f1", "a", "m9")], "a")
  const onTask = checkAttachable(["f1"], [row("f1", "a", null, "t1")], "a")
  assert.equal(onMessage.ok || onMessage.status, 409)
  assert.equal(onTask.ok || onTask.status, 409)
})

test(`붙이기 거부 — 한 글에 ${ATTACH_MAX}개 넘게`, () => {
  const ids = Array.from({ length: ATTACH_MAX + 1 }, (_, i) => `f${i}`)
  const r = checkAttachable(ids, ids.map((id) => row(id, "a")), "a")
  assert.equal(r.ok || r.status, 400)
})
