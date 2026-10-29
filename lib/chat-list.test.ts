/** 메신저 목록 — 칩 · 규칙 폴더 · 안 읽음 · 검색 · 방 키 거부. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"

import {
  acceptsHidden,
  countsAsUnread,
  hiddenFromList,
  roomRemoval,
  decideRoomKeyAccess,
  effectiveReadAt,
  filterRooms,
  folderHasRoom,
  isLiveFolderRule,
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
  lastAt: "2026-10-29T04:00:00.000Z", favorite: true, unread: 3, mine: true, projectId: "p-bio",
})
const newTask = room({ key: "task:t2", kind: "TASK", name: "새 업무", lastAt: "2026-10-28T00:00:00.000Z", mine: false, projectId: "p-bio" })
const otherTask = room({ key: "task:t3", kind: "TASK", name: "남의 업무", lastAt: "2026-10-27T00:00:00.000Z", mine: false, projectId: null })
const rooms = [company, dm, task, newTask, otherTask]

const folder = (over: Partial<ChatFolderView> & Pick<ChatFolderView, "id">): ChatFolderView => ({
  name: over.id, rule: null, order: 0, roomKeys: [], projectId: null, project: null, ...over,
})
const myTasks = folder({ id: "f1", name: "내 업무", rule: "MY_TASKS" })
const bio = folder({ id: "f2", name: "AI 바이오 소재 사업", rule: "PROJECT", projectId: "p-bio", project: { name: "AI 바이오 소재 사업", archived: false } })
// 상표 업무방 + 상표 관련 옴니스 대화 + 전사방을 섞은 수동 폴더
const manual = folder({ id: "f3", name: "상표", roomKeys: ["task:t1", "room:dm1", "room:default-room"] })
const folders = [myTasks, bio, manual]

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

test("내 업무 — 내가 담당이거나 지시한 업무방만", () => {
  assert.equal(folderHasRoom(myTasks, task), true)
  assert.equal(folderHasRoom(myTasks, newTask), false)
  assert.deepEqual(roomsInChip(rooms, "folder:f1", folders).map((r) => r.key), ["task:t1"])
})

test("내 업무 — 업무방이 아닌 방은 들지 않는다 (거부되어야 하는 경우)", () => {
  assert.equal(folderHasRoom(myTasks, { ...dm, mine: true }), false)
  assert.equal(folderHasRoom(myTasks, { ...company, mine: true }), false)
})

test("프로젝트 폴더 — 그 프로젝트의 업무방이 저절로, 새 업무방도", () => {
  assert.deepEqual(roomsInChip(rooms, "folder:f2", folders).map((r) => r.key), ["task:t1", "task:t2"])
  assert.equal(folderHasRoom(bio, otherTask), false)
})

test("프로젝트가 지워진 폴더(projectId null)는 비어 있다 — 프로젝트 없는 업무와 맞추지 않는다", () => {
  const gone = folder({ id: "g", rule: "PROJECT", projectId: null, project: null })
  assert.equal(folderHasRoom(gone, otherTask), false)
  assert.deepEqual(roomsInChip(rooms, "folder:g", [gone]), [])
})

test("규칙 폴더는 손으로 넣은 키를 보지 않는다", () => {
  assert.equal(folderHasRoom({ ...bio, roomKeys: ["room:dm1"] }, dm), false)
})

test("수동 폴더는 종류를 섞는다 — 업무방 · 옴니스 대화 · 전사방", () => {
  assert.deepEqual(roomsInChip(rooms, "folder:f3", folders).map((r) => r.key), ["room:dm1", "task:t1", "room:default-room"])
})

test("옛 규칙(전사방 · 업무방 · 단톡방)은 숨긴다", () => {
  assert.equal(isLiveFolderRule(null), true)
  assert.equal(isLiveFolderRule("MY_TASKS"), true)
  assert.equal(isLiveFolderRule("PROJECT"), true)
  assert.equal(isLiveFolderRule("COMPANY"), false)
  assert.equal(isLiveFolderRule("TASK"), false)
  assert.equal(isLiveFolderRule("GROUP"), false)
})

test("방금 만든 폴더의 칩을 고를 수 있다 — 목록에 그 폴더가 오면 「전체」 로 튕기지 않는다", () => {
  const fresh = folder({ id: "new1", name: "테스트" })
  assert.equal(resolveChip("folder:new1", [...folders, fresh]), "folder:new1")
  assert.equal(resolveChip("folder:new1", folders), "all")
})

// ─── 칩 ───

test("전체는 종류를 가리지 않고 최근 글 순 한 목록", () => {
  // 전사방도 다른 방과 같이 최근 글 순 — 맨 위에 고정하지 않는다
  assert.deepEqual(roomsInChip(rooms, "all", folders).map((r) => r.key), ["room:dm1", "task:t1", "room:default-room", "task:t2", "task:t3"])
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

// ─── 지우기 · 숨기기 · 나가기 (2026-10-29) ───

test("방 종류별 밀기 동작 — 옴니스 삭제 · 사람 1:1 숨기기 · 단톡 나가기 · 전사방 · 업무방은 없음", () => {
  assert.equal(roomRemoval("OMNIS_DM"), "delete")
  assert.equal(roomRemoval("DM"), "hide")
  assert.equal(roomRemoval("GROUP"), "leave")
  assert.equal(roomRemoval("COMPANY"), null)
  assert.equal(roomRemoval("TASK"), null)
})

test("숨김은 옴니스 1:1 · 사람 1:1 에만 (거부되어야 하는 경우: 전사방 · 업무방 · 단톡방)", () => {
  assert.equal(acceptsHidden("OMNIS_DM"), true)
  assert.equal(acceptsHidden("DM"), true)
  assert.equal(acceptsHidden("GROUP"), false)
  assert.equal(acceptsHidden("COMPANY"), false)
  assert.equal(acceptsHidden("TASK"), false)
})

test("지운 옴니스 대화는 늘 빠진다 · 숨긴 사람 1:1 은 숨긴 뒤 새 글이 오면 다시 보인다", () => {
  const at = "2026-10-29T05:00:00.000Z"
  assert.equal(hiddenFromList({ kind: "OMNIS_DM", lastAt: "2026-10-29T06:00:00.000Z" }, at), true)
  assert.equal(hiddenFromList({ kind: "DM", lastAt: "2026-10-29T04:59:00.000Z" }, at), true)
  assert.equal(hiddenFromList({ kind: "DM", lastAt: "2026-10-29T05:00:01.000Z" }, at), false)
  assert.equal(hiddenFromList({ kind: "DM", lastAt: at }, null), false)
  // 숨김을 받지 않는 방에 값이 있어도(잘못 쓴 행) 목록에서 빼지 않는다
  assert.equal(hiddenFromList({ kind: "COMPANY", lastAt: at }, at), false)
})
