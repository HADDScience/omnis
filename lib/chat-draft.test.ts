/** 채팅 입력창 임시저장 규칙. 실행: pnpm test:unit */
import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"

import {
  DRAFT_MAX_CHARS,
  DRAFT_PREVIEW_CHARS,
  DRAFT_TTL_MS,
  clearAllDrafts,
  clearDraft,
  draftKey,
  draftPreview,
  parseDraft,
  readDraft,
  roomKeyOfDraftKey,
  serializeDraft,
  sweepDrafts,
  writeDraft,
} from "./chat-draft"

/** 브라우저 localStorage 흉내 — Map 하나 */
class MemoryStorage {
  map = new Map<string, string>()
  get length() {
    return this.map.size
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null
  }
  getItem(k: string) {
    return this.map.get(k) ?? null
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v))
  }
  removeItem(k: string) {
    this.map.delete(k)
  }
  clear() {
    this.map.clear()
  }
}

let store: MemoryStorage
let events: string[]
beforeEach(() => {
  store = new MemoryStorage()
  events = []
  ;(globalThis as Record<string, unknown>).window = {
    localStorage: store,
    dispatchEvent: (e: { detail: { roomKey: string } }) => {
      events.push(e.detail.roomKey)
      return true
    },
  }
  ;(globalThis as Record<string, unknown>).CustomEvent ??= class {
    detail: unknown
    constructor(_type: string, init: { detail: unknown }) {
      this.detail = init.detail
    }
  }
})

const NOW = Date.UTC(2026, 10, 11, 3, 0, 0)
const ME = "u-me"
const ROOM = "room:r1"

test("사람 · 방 단위 키 — 다른 사람의 초안은 내 것으로 읽지 않는다", () => {
  assert.equal(draftKey(ME, ROOM), "omnis.chat.draft.u-me.room:r1")
  assert.equal(roomKeyOfDraftKey(draftKey(ME, "task:t9"), ME), "task:t9")
  assert.equal(roomKeyOfDraftKey(draftKey("u-other", ROOM), ME), null)
  writeDraft("u-other", ROOM, "남의 글", NOW)
  assert.equal(readDraft(ME, ROOM, NOW), null)
})

test("줄바꿈 · 멘션 · 업무 언급은 글자 그대로 되살린다", () => {
  const text = "@허채정 님\n#ADD-12 확인 부탁드립니다\n\n  들여쓴 줄"
  writeDraft(ME, ROOM, text, NOW)
  assert.equal(readDraft(ME, ROOM, NOW + 1000), text)
})

test("비우면(보냄 · 다 지움) 지운다 — 공백뿐인 글도 저장하지 않는다", () => {
  writeDraft(ME, ROOM, "쓰던 글", NOW)
  writeDraft(ME, ROOM, "", NOW)
  assert.equal(store.getItem(draftKey(ME, ROOM)), null)
  writeDraft(ME, ROOM, "  \n ", NOW)
  assert.equal(store.length, 0)
  writeDraft(ME, ROOM, "또", NOW)
  clearDraft(ME, ROOM)
  assert.equal(store.length, 0)
})

test("7일이 지난 초안은 읽을 때 지운다", () => {
  writeDraft(ME, ROOM, "오래된 글", NOW)
  assert.equal(readDraft(ME, ROOM, NOW + DRAFT_TTL_MS), "오래된 글")
  assert.equal(readDraft(ME, ROOM, NOW + DRAFT_TTL_MS + 1), null)
  assert.equal(store.length, 0)
})

test("되살리기만 해서는 시각이 늘지 않는다 — 같은 글을 다시 저장하면 그대로", () => {
  writeDraft(ME, ROOM, "글", NOW)
  writeDraft(ME, ROOM, "글", NOW + 5000)
  assert.equal(parseDraft(store.getItem(draftKey(ME, ROOM)), NOW)?.at, NOW)
  assert.deepEqual(events, [ROOM])
  writeDraft(ME, ROOM, "글자", NOW + 6000)
  assert.equal(parseDraft(store.getItem(draftKey(ME, ROOM)), NOW)?.at, NOW + 6000)
  assert.deepEqual(events, [ROOM, ROOM])
})

test("모양이 틀린 값은 없는 것으로 본다", () => {
  for (const raw of ["", "not json", "null", "[]", '{"text":1,"at":1}', '{"text":"x"}', '{"text":"  ","at":1}']) {
    assert.equal(parseDraft(raw, NOW), null, raw)
  }
  assert.equal(parseDraft(null, NOW), null)
})

test("긴 글은 상한까지만 둔다", () => {
  const long = "가".repeat(DRAFT_MAX_CHARS + 50)
  assert.equal(JSON.parse(serializeDraft(long, NOW)!).text.length, DRAFT_MAX_CHARS)
})

test("목록 미리보기 — 「임시저장:」 뒤 한 줄로 줄여 앞부분만", () => {
  assert.equal(draftPreview("첫 줄\n\n둘째   줄"), "임시저장: 첫 줄 둘째 줄")
  const p = draftPreview("가".repeat(DRAFT_PREVIEW_CHARS + 10))
  assert.equal(p, `임시저장: ${"가".repeat(DRAFT_PREVIEW_CHARS)}…`)
})

test("목록용으로 모을 때 내 초안만 돌려주고 오래된 것 · 깨진 것은 사람 가리지 않고 지운다", () => {
  writeDraft(ME, "room:a", "a 글", NOW)
  writeDraft(ME, "task:b", "b 글", NOW - DRAFT_TTL_MS - 1)
  writeDraft("u-other", "room:a", "남의 글", NOW)
  writeDraft("u-other", "room:c", "남의 오래된 글", NOW - DRAFT_TTL_MS - 1)
  store.setItem(draftKey(ME, "room:z"), "깨진 값")
  store.setItem("다른 앱 키", "그대로")
  const mine = sweepDrafts(ME, NOW)
  assert.deepEqual([...mine], [["room:a", "a 글"]])
  assert.deepEqual([...store.map.keys()].sort(), [draftKey(ME, "room:a"), draftKey("u-other", "room:a"), "다른 앱 키"].sort())
})

test("로그아웃 — 이 기기의 초안을 모두 지우고 다른 값은 남긴다", () => {
  writeDraft(ME, "room:a", "a", NOW)
  writeDraft("u-other", "room:b", "b", NOW)
  store.setItem("omnis.chat-cache.owner", ME)
  clearAllDrafts()
  assert.deepEqual([...store.map.keys()], ["omnis.chat-cache.owner"])
})

test("저장소가 막혀 있어도 던지지 않는다", () => {
  ;(globalThis as Record<string, unknown>).window = {
    get localStorage(): Storage {
      throw new Error("SecurityError")
    },
    dispatchEvent: () => true,
  }
  assert.doesNotThrow(() => writeDraft(ME, ROOM, "글", NOW))
  assert.equal(readDraft(ME, ROOM, NOW), null)
  assert.equal(sweepDrafts(ME, NOW).size, 0)
  assert.doesNotThrow(() => clearAllDrafts())
})

test("사람이나 방 키를 모르면(메신저 밖) 아무것도 하지 않는다", () => {
  writeDraft("", ROOM, "글", NOW)
  writeDraft(ME, "", "글", NOW)
  assert.equal(store.length, 0)
  assert.equal(readDraft("", ROOM, NOW), null)
})
