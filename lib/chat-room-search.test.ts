/** 방 글 낱말 검색 — 권한 필터 · 낱말 · 병합 순서 · 결과 모양. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"

import { escapeLike, formatRoomHit, keepPermitted, mergeResults, roomLimit, searchableRooms, splitWords, type RoomHit } from "./chat-room-search"

const LABEL = { COMPANY: "전사방", OMNIS_DM: "옴니스 1:1", GROUP: "단톡방", DM: "1:1" }

test("권한 — 읽을 수 있는 방 중 전사방을 빼고 단톡 · 1:1 · 옴니스 1:1 만 찾는다", () => {
  const readable = [
    { id: "c", kind: "COMPANY" },
    { id: "g", kind: "GROUP" },
    { id: "d", kind: "DM" },
    { id: "o", kind: "OMNIS_DM" },
    { id: "t", kind: "TASK" },
  ]
  assert.deepEqual(searchableRooms(readable).map((r) => r.id), ["g", "d", "o"])
  assert.deepEqual(searchableRooms([]), [])
})

test("권한 — 검색할 방 목록에 없는 방의 글은 결과에서 빠진다", () => {
  const hits = [
    { roomId: "g", messageId: "1" },
    { roomId: "남의방", messageId: "2" },
    { roomId: "c", messageId: "3" },
    { roomId: "d", messageId: "4" },
  ]
  const rooms = searchableRooms([{ id: "c", kind: "COMPANY" }, { id: "g", kind: "GROUP" }, { id: "d", kind: "DM" }])
  assert.deepEqual(keepPermitted(hits, rooms).map((h) => h.messageId), ["1", "4"])
  assert.deepEqual(keepPermitted(hits, []), [], "방이 없으면 아무것도")
})

test("낱말 — 공백 · 문장부호로 자르고 2자 미만 · 중복을 뺀다, 6개까지", () => {
  assert.deepEqual(splitWords("  견적서, 보냈어?  견적서 A "), ["견적서", "보냈어"])
  assert.deepEqual(splitWords("ADD-Gel 샘플 (3월)"), ["add", "gel", "샘플", "3월"])
  assert.deepEqual(splitWords("가 나 다"), [])
  assert.equal(splitWords("하나둘 셋넷 다섯 여섯 일곱 여덟 아홉").length, 6)
})

test("낱말 — LIKE 와일드카드는 글자로", () => {
  assert.equal(escapeLike("50%_할인\\"), "50\\%\\_할인\\\\")
})

test("병합 — 의미 검색 1등이 맨 앞, 번갈아, 방 결과는 limit 의 절반까지", () => {
  const e = ["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8"]
  const r = ["r1", "r2", "r3", "r4", "r5", "r6"]
  const out = mergeResults(e, r, 8).map((m) => m.item)
  assert.deepEqual(out, ["e1", "r1", "e2", "r2", "e3", "r3", "e4", "r4"])
  assert.equal(roomLimit(8), 4)
  assert.equal(roomLimit(1), 1)
})

test("병합 — 한쪽이 모자라면 다른 쪽이 채우되 방은 절반을 넘지 않는다", () => {
  assert.deepEqual(mergeResults(["e1"], ["r1", "r2", "r3", "r4", "r5"], 8).map((m) => m.item), ["e1", "r1", "r2", "r3", "r4"])
  assert.deepEqual(mergeResults(["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8", "e9"], ["r1"], 8).map((m) => m.item), ["e1", "r1", "e2", "e3", "e4", "e5", "e6", "e7"])
  assert.deepEqual(mergeResults([], ["r1", "r2"], 8).map((m) => m.kind), ["room", "room"])
  assert.deepEqual(mergeResults([], [], 8), [])
})

test("결과 모양 — 방임이 머리줄에 드러나고 앞뒤 대화가 붙는다", () => {
  const at = (iso: string) => new Date(iso)
  const hit: RoomHit = {
    messageId: "m", roomId: "g", roomTitle: "샘플 발송", roomKind: "GROUP",
    createdAt: at("2026-11-06T05:03:00Z"), author: "사원1", content: "견적서\n오늘 보냈습니다", score: 1,
    before: [{ createdAt: at("2026-11-06T05:00:00Z"), author: "사원3", content: "견적서 어떻게 됐어요?" }],
    after: [{ createdAt: at("2026-11-06T05:05:00Z"), author: "부팀장", content: "확인했습니다" }],
  }
  assert.equal(
    formatRoomHit(2, hit, LABEL),
    [
      "[2] 방 · 단톡방 「샘플 발송」 · 사원1 · 2026-11-06 14:03",
      "  14:00 사원3: 견적서 어떻게 됐어요?",
      "▶ 견적서 오늘 보냈습니다",
      "  14:05 부팀장: 확인했습니다",
    ].join("\n"),
  )
})
