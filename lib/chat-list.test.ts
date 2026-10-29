/** 메신저 목록 — 칩 · 규칙 폴더 · 안 읽음 · 검색 · 방 키 거부. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"

import {
  countsAsUnread,
  decideRoomKeyAccess,
  effectiveReadAt,
  filterRooms,
  folderHasRoom,
  matchesRoomQuery,
  parseRoomKey,
  resolveChip,
  roomKeyFromPath,
  roomKeyOf,
  roomsInChip,
  unreadLabel,
  unreadRoomCount,
  type ChatFolderView,
  type ListRoom,
} from "./chat-list"

const room = (over: Partial<ListRoom> & Pick<ListRoom, "key" | "kind">): ListRoom => ({
  name: over.key,
  lastAt: "2026-10-29T00:00:00.000Z",
  preview: null,
  unread: 0,
  favorite: false,
  ...over,
})

const company = room({ key: "room:default-room", kind: "COMPANY", name: "하드사이언스", lastAt: "2026-10-29T03:00:00.000Z" })
const dm = room({ key: "room:dm1", kind: "OMNIS_DM", name: "지연 업무 몇 건?", lastAt: "2026-10-29T05:00:00.000Z", unread: 1 })
const task = room({
  key: "task:t1", kind: "TASK", name: "견적서 보내기", slug: "task-14139531", preview: "윤훈: 견적 금액 확인 부탁드립니다",
  lastAt: "2026-10-29T04:00:00.000Z", favorite: true, unread: 3,
})
const newTask = room({ key: "task:t2", kind: "TASK", name: "새 업무", lastAt: "2026-10-28T00:00:00.000Z" })
const rooms = [company, dm, task, newTask]

const ruleTask: ChatFolderView = { id: "f1", name: "업무방", rule: "TASK", order: 0, roomKeys: [] }
const ruleCompany: ChatFolderView = { id: "f2", name: "전사방", rule: "COMPANY", order: 1, roomKeys: [] }
const manual: ChatFolderView = { id: "f3", name: "견적", rule: null, order: 2, roomKeys: ["task:t1", "room:dm1"] }
const folders = [ruleTask, ruleCompany, manual]

// ─── 방 키 ───

test("방 키 — 업무방은 task:, 나머지는 room:", () => {
  assert.equal(roomKeyOf({ kind: "TASK", id: "t1" }), "task:t1")
  assert.equal(roomKeyOf({ kind: "COMPANY", id: "default-room" }), "room:default-room")
  assert.equal(roomKeyOf({ kind: "OMNIS_DM", id: "abc" }), "room:abc")
})

test("방 키 해석 — 기준 줄 `*` · 다른 접두사 · 이상한 글자는 거부", () => {
  assert.deepEqual(parseRoomKey("task:t1"), { type: "task", id: "t1" })
  assert.equal(parseRoomKey("*"), null)
  assert.equal(parseRoomKey("user:u1"), null)
  assert.equal(parseRoomKey("room:"), null)
  assert.equal(parseRoomKey("room:a b"), null)
  assert.equal(parseRoomKey("room:" + "a".repeat(65)), null)
  assert.equal(parseRoomKey(42), null)
})

test("주소 → 방 키. /chat · /chat/new 는 방이 아니다", () => {
  assert.equal(roomKeyFromPath("/chat/default-room"), "room:default-room")
  assert.equal(roomKeyFromPath("/chat/task/t1"), "task:t1")
  assert.equal(roomKeyFromPath("/chat"), null)
  assert.equal(roomKeyFromPath("/chat/new"), null)
  assert.equal(roomKeyFromPath("/tasks/t1"), null)
})

// ─── 남의 방 키 거부 ───

test("남의 1:1 방 키는 forbidden (거부되어야 하는 경우)", () => {
  assert.equal(decideRoomKeyAccess({ key: "room:dm-b", room: { kind: "OMNIS_DM", isMember: false } }), "forbidden")
  assert.equal(decideRoomKeyAccess({ key: "room:group-b", room: { kind: "GROUP", isMember: false } }), "forbidden")
})

test("내 1:1 방 · 전사방 · 있는 업무방은 ok", () => {
  assert.equal(decideRoomKeyAccess({ key: "room:dm-a", room: { kind: "OMNIS_DM", isMember: true } }), "ok")
  assert.equal(decideRoomKeyAccess({ key: "room:default-room", room: { kind: "COMPANY", isMember: false } }), "ok")
  assert.equal(decideRoomKeyAccess({ key: "task:t1", taskExists: true }), "ok")
})

test("없는 방 · 없는 업무는 missing, 잘못된 키는 invalid (거부되어야 하는 경우)", () => {
  assert.equal(decideRoomKeyAccess({ key: "room:nope", room: null }), "missing")
  assert.equal(decideRoomKeyAccess({ key: "task:nope", taskExists: false }), "missing")
  assert.equal(decideRoomKeyAccess({ key: "*" }), "invalid")
  assert.equal(decideRoomKeyAccess({ key: "room:x", room: { kind: "TASK", isMember: true } }), "invalid")
})

// ─── 규칙 폴더 ───

test("규칙 폴더는 방 종류로 채운다 — 새 업무방도 저절로", () => {
  assert.equal(folderHasRoom(ruleTask, task), true)
  assert.equal(folderHasRoom(ruleTask, newTask), true)
  assert.equal(folderHasRoom(ruleTask, company), false)
  assert.equal(folderHasRoom(ruleTask, dm), false)
  assert.deepEqual(roomsInChip(rooms, "folder:f2", folders).map((r) => r.key), ["room:default-room"])
})

test("규칙 폴더는 손으로 넣은 키를 보지 않는다", () => {
  const odd: ChatFolderView = { ...ruleCompany, roomKeys: ["task:t1"] }
  assert.equal(folderHasRoom(odd, task), false)
})

test("수동 폴더는 넣은 방만", () => {
  assert.deepEqual(roomsInChip(rooms, "folder:f3", folders).map((r) => r.key), ["room:dm1", "task:t1"])
})

// ─── 칩 ───

test("전체는 종류를 가리지 않고 최근 글 순 한 목록", () => {
  assert.deepEqual(roomsInChip(rooms, "all", folders).map((r) => r.key), ["room:dm1", "task:t1", "room:default-room", "task:t2"])
})

test("옴니스 · 안읽음 · 즐겨찾기", () => {
  assert.deepEqual(roomsInChip(rooms, "omnis", folders).map((r) => r.key), ["room:dm1"])
  assert.deepEqual(roomsInChip(rooms, "unread", folders).map((r) => r.key), ["room:dm1", "task:t1"])
  assert.deepEqual(roomsInChip(rooms, "favorite", folders).map((r) => r.key), ["task:t1"])
})

test("지운 폴더의 칩은 비고, 저장해 둔 칩도 「전체」 로 돌아간다", () => {
  assert.deepEqual(roomsInChip(rooms, "folder:gone", folders), [])
  assert.equal(resolveChip("folder:gone", folders), "all")
  assert.equal(resolveChip("folder:f3", folders), "folder:f3")
  assert.equal(resolveChip("unread", folders), "unread")
  assert.equal(resolveChip("이상한값", folders), "all")
  assert.equal(resolveChip(null, folders), "all")
})

// ─── 안 읽음 ───

const T0 = new Date("2026-10-29T00:00:00Z")
const later = new Date("2026-10-29T01:00:00Z")
const earlier = new Date("2026-10-28T23:00:00Z")
const ctx = (roomKind: ListRoom["kind"]) => ({ userId: "me", systemUserId: "system", roomKind, readAt: T0 })

test("안 읽음 — 읽은 뒤 남이 쓴 글만", () => {
  assert.equal(countsAsUnread({ authorId: "you", createdAt: later }, ctx("COMPANY")), true)
  assert.equal(countsAsUnread({ authorId: "you", createdAt: earlier }, ctx("COMPANY")), false)
  assert.equal(countsAsUnread({ authorId: "you", createdAt: T0 }, ctx("COMPANY")), false)
})

test("안 읽음 — 내 글 · 지운 글은 세지 않는다 (거부되어야 하는 경우)", () => {
  assert.equal(countsAsUnread({ authorId: "me", createdAt: later }, ctx("COMPANY")), false)
  assert.equal(countsAsUnread({ authorId: "you", createdAt: later, deletedAt: later }, ctx("TASK")), false)
})

test("안 읽음 — 시스템 계정 글은 옴니스 1:1 방에서만 센다", () => {
  assert.equal(countsAsUnread({ authorId: "system", createdAt: later }, ctx("COMPANY")), false)
  assert.equal(countsAsUnread({ authorId: "system", createdAt: later }, ctx("TASK")), false)
  assert.equal(countsAsUnread({ authorId: "system", createdAt: later }, ctx("OMNIS_DM")), true)
})

test("한 번도 안 연 방은 기준 시각부터 센다", () => {
  assert.equal(effectiveReadAt(null, T0), T0)
  assert.equal(effectiveReadAt(later, T0), later)
})

test("안읽음 칩 배지는 방의 수 · 100 부터 99+", () => {
  assert.equal(unreadRoomCount(rooms), 2)
  assert.equal(unreadLabel(3), "3")
  assert.equal(unreadLabel(99), "99")
  assert.equal(unreadLabel(100), "99+")
})

// ─── 검색 ───

test("검색 — 방 이름 · 슬러그(#붙여도) · 마지막 글 미리보기 · 보낸 사람", () => {
  assert.equal(matchesRoomQuery(task, "견적서"), true)
  assert.equal(matchesRoomQuery(task, "#task-1413"), true)
  assert.equal(matchesRoomQuery(task, "금액"), true)
  assert.equal(matchesRoomQuery(task, "윤훈"), true)
  assert.equal(matchesRoomQuery(company, "하드"), true)
})

test("검색 — 없는 말은 걸리지 않는다 · 대소문자 무시 · 빈 검색어는 전부 (거부되어야 하는 경우 포함)", () => {
  assert.equal(matchesRoomQuery(task, "회의록"), false)
  assert.equal(matchesRoomQuery(room({ key: "room:x", kind: "COMPANY", name: "HADD 팀" }), "hadd"), true)
  assert.deepEqual(filterRooms(rooms, "  ").length, rooms.length)
  assert.deepEqual(filterRooms(rooms, "견적").map((r) => r.key), ["task:t1"])
})
