/** 채팅 커서. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"

import {
  applyChanges,
  changedSince,
  compareMessages,
  encodeCursor,
  laterOf,
  mergeIncoming,
  olderThan,
  parseCursor,
  pollSince,
  POLL_OVERLAP_MS,
} from "./chat-cursor"

const T = "2026-08-20T03:00:00.000Z"
const msg = (id: string, createdAt = T) => ({ id, createdAt })
const isLocal = (m: { id: string }) => m.id.startsWith("temp-")

test("커서는 시각과 id 를 함께 싣고 그대로 읽힌다", () => {
  const c = parseCursor(encodeCursor(msg("b")))
  assert.deepEqual(c, { createdAt: new Date(T), id: "b" })
})

test("시각만 보내는 옛 화면도 읽는다 — id 는 null", () => {
  assert.deepEqual(parseCursor(T), { createdAt: new Date(T), id: null })
})

test("거부 — 시각이 아닌 커서는 null", () => {
  assert.equal(parseCursor("어제|abc"), null)
  assert.equal(parseCursor(""), null)
  assert.equal(parseCursor(null), null)
})

test("이전 페이지는 같은 시각이면 id 로 가른다 — 경계 시각의 글이 빠지지 않는다", () => {
  assert.deepEqual(olderThan({ createdAt: new Date(T), id: "m" }), {
    OR: [{ createdAt: { lt: new Date(T) } }, { createdAt: new Date(T), id: { lt: "m" } }],
  })
})

test("id 없는 옛 커서는 예전처럼 시각만 본다", () => {
  assert.deepEqual(olderThan({ createdAt: new Date(T), id: null }), { createdAt: { lt: new Date(T) } })
})

test("폴링은 커서보다 겹침 시간만큼 앞부터 읽는다 — 늦게 커밋된 글을 다시 줍는다", () => {
  const where = pollSince({ createdAt: new Date(T), id: "m" })
  assert.equal(where.createdAt.gt.getTime(), new Date(T).getTime() - POLL_OVERLAP_MS)
})

test("순서는 시각, 같으면 id", () => {
  assert.ok(compareMessages(msg("a"), msg("b")) < 0)
  assert.ok(compareMessages(msg("z", "2026-08-20T02:59:59.000Z"), msg("a")) < 0)
  assert.equal(compareMessages(msg("a"), msg("a")), 0)
})

test("커서는 뒤로 가지 않는다 — 겹쳐 읽은 옛 글이 마지막이어도", () => {
  const cur = msg("m", "2026-08-20T03:00:05.000Z")
  assert.equal(laterOf(cur, msg("a")), cur)
  assert.equal(laterOf(null, cur), cur)
})

test("겹쳐 읽은 글은 다시 붙지 않는다 · 바뀐 것이 없으면 같은 배열", () => {
  const prev = [msg("a"), msg("b")]
  assert.equal(mergeIncoming(prev, [msg("a"), msg("b")], isLocal), prev)
})

test("늦게 커밋된 글은 뒤에 온 글보다 앞, 제자리에 들어간다", () => {
  const prev = [msg("a", "2026-08-20T03:00:00.000Z"), msg("c", "2026-08-20T03:00:02.000Z")]
  const late = msg("b", "2026-08-20T03:00:01.000Z")
  assert.deepEqual(
    mergeIncoming(prev, [late, prev[1]], isLocal).map((m) => m.id),
    ["a", "b", "c"],
  )
})

test("보내는 중인 글은 새 글이 와도 맨 뒤에 남는다", () => {
  const prev = [msg("a"), msg("temp-1", "2026-08-20T03:00:09.000Z")]
  const next = mergeIncoming(prev, [msg("b", "2026-08-20T03:00:01.000Z")], isLocal)
  assert.deepEqual(next.map((m) => m.id), ["a", "b", "temp-1"])
})

test("바뀐 글은 겹침 시간만큼 앞부터 본다", () => {
  const where = changedSince(new Date(T))
  assert.equal(where.changedAt.gt.getTime(), new Date(T).getTime() - POLL_OVERLAP_MS)
})

type Row = { id: string; content: string; changedAt: string | null }

test("남이 지운 글은 제자리에서 바뀐다 · 순서는 그대로", () => {
  const prev: Row[] = [
    { id: "a", content: "안녕", changedAt: null },
    { id: "b", content: "비밀번호는 1234", changedAt: null },
    { id: "c", content: "끝", changedAt: null },
  ]
  const next = applyChanges(prev, [{ id: "b", content: "삭제된 메시지입니다", changedAt: T }])
  assert.deepEqual(next.map((m) => m.content), ["안녕", "삭제된 메시지입니다", "끝"])
  assert.equal(next[0], prev[0])
})

test("겹쳐 읽어 같은 변경이 다시 오면 그대로 — 다시 그리지 않는다", () => {
  const prev = [{ id: "b", content: "고침", changedAt: T }]
  assert.equal(applyChanges(prev, [{ id: "b", content: "고침", changedAt: T }]), prev)
})

test("거부 — 목록에 없는 글의 변경은 끼워 넣지 않는다", () => {
  const prev: Row[] = [{ id: "a", content: "안녕", changedAt: null }]
  assert.equal(applyChanges(prev, [{ id: "zz", content: "옛 글", changedAt: T }]), prev)
})
