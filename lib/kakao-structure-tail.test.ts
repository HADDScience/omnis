/** 구조화 뒷부분의 앞 맥락 · 메시지 고르기. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import type { RawSession } from "../import-tools/kakao-common"
import { pickMessages, tailSession, TAIL_CONTEXT } from "../import-tools/structure-tail"

const msg = (t: string, m: string) => ({ t: `2026-01-01 ${t}`, u: "예시담당", m })
const session: RawSession = {
  id: "s1", room: "예시방", start: "2026-01-01 10:00", end: "2026-01-01 10:05", n: 5,
  msgs: [msg("10:00", "회의 몇 시죠"), msg("10:01", "Photo"), msg("10:02", "요것을 안내 카드에 넣으세요~"), msg("10:03", "https://example.com/video"), msg("10:04", "아고 이건 또 언제 나왔지!!!")],
}

test("뒷부분 — 끊긴 앞 사진이 맥락으로 오고 받은 메시지 수는 뒷부분만이다", () => {
  const tail = tailSession(session, 2)
  assert.equal(tail.id, "s1@2")
  assert.equal(tail.msgs.length, 3)
  assert.equal(tail.n, 3)
  assert.equal(tail.start, "2026-01-01 10:02")
  assert.deepEqual(tail.before?.map((m) => m.m), ["회의 몇 시죠", "Photo"])
})

test("앞 맥락은 최대 TAIL_CONTEXT 개", () => {
  const long = { ...session, msgs: Array.from({ length: 20 }, (_, i) => msg(`10:${i}`, `글 ${i}`)) }
  assert.equal(tailSession(long, 15).before?.length, TAIL_CONTEXT)
  assert.equal(tailSession(long, 15).before?.at(-1)?.m, "글 14")
})

test("고르기 — 음수는 앞 맥락의 첨부만 받고, 범위 밖 번호는 버린다", () => {
  const tail = tailSession(session, 2)
  assert.deepEqual(pickMessages({ messages: [-1, 0] }, tail).map((m) => m.m), ["Photo", "요것을 안내 카드에 넣으세요~"])
  assert.deepEqual(pickMessages({ messages: [-2, 0] }, tail).map((m) => m.m), ["요것을 안내 카드에 넣으세요~"])
  assert.deepEqual(pickMessages({ messages: [-9, 99, 0] }, tail).map((m) => m.m), ["요것을 안내 카드에 넣으세요~"])
  assert.equal(pickMessages({}, tail).length, 3)
})

test("맥락 없는 세션은 음수를 받지 않는다", () => {
  assert.deepEqual(pickMessages({ messages: [-1, 1] }, session).map((m) => m.m), ["Photo"])
})

test("프롬프트에 지시어 규칙과 before 설명이 있다", () => {
  const md = readFileSync("import-tools/prompts/structure.md", "utf8")
  assert.match(md, /지시어의 대상/)
  assert.match(md, /`before`/)
  assert.match(md, /혼잣말/)
})
