/** 오른쪽 패널 채팅 — 방 주소 · 기억한 방 읽기 · 채팅 탭이 갈 곳 · 패널 닫기. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"

import { chatTabHref, closesPanelOn, isChatPath, parsePanelRoom, roomHref, serializePanelRoom, type PanelRoomRef } from "./panel-chat-rules"

const omnis: PanelRoomRef = { id: "r1", key: "room:r1", kind: "OMNIS_DM", name: "견적 정리" }
const task: PanelRoomRef = { id: "t1", key: "task:t1", kind: "TASK", name: "시약 주문", muted: true }

test("방 주소 — 업무방만 /chat/task/", () => {
  assert.equal(roomHref(omnis), "/chat/r1")
  assert.equal(roomHref({ kind: "COMPANY", id: "c1" }), "/chat/c1")
  assert.equal(roomHref(task), "/chat/task/t1")
})

test("기억한 방 — 저장한 그대로 돌아온다", () => {
  assert.deepEqual(parsePanelRoom(serializePanelRoom(omnis)), omnis)
  assert.deepEqual(parsePanelRoom(serializePanelRoom(task)), task)
})

test("기억한 방 — 모양이 틀리면 없는 것으로", () => {
  assert.equal(parsePanelRoom(null), null)
  assert.equal(parsePanelRoom(""), null)
  assert.equal(parsePanelRoom("{깨진"), null)
  assert.equal(parsePanelRoom(JSON.stringify("room:r1")), null)
  // 종류와 키가 어긋남 — 업무방인데 room: 키
  assert.equal(parsePanelRoom(JSON.stringify({ ...task, key: "room:t1" })), null)
  // 모르는 종류
  assert.equal(parsePanelRoom(JSON.stringify({ ...omnis, kind: "SECRET" })), null)
  // 주소를 바꾸는 id
  assert.equal(parsePanelRoom(JSON.stringify({ id: "../settings", key: "room:../settings", kind: "DM", name: "x" })), null)
})

test("기억한 방 — 이름이 없으면 빈 이름, 너무 길면 자른다", () => {
  assert.equal(parsePanelRoom(JSON.stringify({ id: "r1", key: "room:r1", kind: "DM" }))?.name, "")
  assert.equal(parsePanelRoom(JSON.stringify({ ...omnis, name: "가".repeat(500) }))?.name.length, 200)
})

test("채팅 탭 — 패널을 연 채 누르면 마지막 방, 아니면 목록", () => {
  assert.equal(chatTabHref(true, omnis), "/chat/r1")
  assert.equal(chatTabHref(true, task), "/chat/task/t1")
  assert.equal(chatTabHref(true, null), "/chat")
  assert.equal(chatTabHref(false, omnis), "/chat")
})

test("채팅 화면에 들어온 순간에만 패널을 닫는다", () => {
  assert.equal(isChatPath("/chat"), true)
  assert.equal(isChatPath("/chat/task/t1"), true)
  assert.equal(isChatPath("/chatter"), false)
  assert.equal(isChatPath(null), false)
  assert.equal(closesPanelOn("/tasks", "/chat"), true)
  assert.equal(closesPanelOn("/tasks", "/chat/r1"), true)
  // 첫 화면이 채팅이면(저장된 「열림」 이 남아 있어도) 닫는다
  assert.equal(closesPanelOn(null, "/chat"), true)
  // 채팅 안에서 방을 옮기는 것은 들어온 것이 아니다 — 거기서 연 패널은 그대로
  assert.equal(closesPanelOn("/chat", "/chat/r1"), false)
  assert.equal(closesPanelOn("/chat/r1", "/tasks"), false)
})
