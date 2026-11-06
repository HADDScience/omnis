/**
 * 시범 운영 측정의 주 단위 묶음 — 주 경계(한국 시간 월요일) · 수신율 · 카톡 비율 · 검색 묶기 · 활성 날. 실행: pnpm test:unit
 */
import { test } from "node:test"
import assert from "node:assert/strict"

import { kstWeekStart, percentile, pilotWeeks, sessionize, summarizePilot, type PilotInput } from "./pilot"

// 2026-11-02(월) 0시 KST = 2026-11-01T15:00Z
const MON = new Date("2026-11-01T15:00:00Z")
const at = (iso: string) => new Date(iso)

test("주는 한국 시간 월요일 0시에 시작한다", () => {
  assert.equal(kstWeekStart(at("2026-11-01T15:00:00Z")).toISOString(), MON.toISOString()) // 월 0시
  assert.equal(kstWeekStart(at("2026-11-01T14:59:59Z")).toISOString(), "2026-10-25T15:00:00.000Z") // 일 23:59 → 앞 주
  assert.equal(kstWeekStart(at("2026-11-08T14:00:00Z")).toISOString(), MON.toISOString()) // 일 23시
  const weeks = pilotWeeks(at("2026-11-06T03:00:00Z"), 3)
  assert.deepEqual(weeks.map((w) => w.toISOString()), ["2026-10-18T15:00:00.000Z", "2026-10-25T15:00:00.000Z", MON.toISOString()])
})

test("입력 중 이어 온 검색은 1분 안이면 한 번으로 센다 — 사람 · 이름마다 따로", () => {
  const rows = [
    { userId: "a", name: "search_chat", at: at("2026-11-02T01:00:00Z") },
    { userId: "a", name: "search_chat", at: at("2026-11-02T01:00:20Z") },
    { userId: "a", name: "search_chat", at: at("2026-11-02T01:00:50Z") }, // 앞 요청과 30초 — 같은 검색
    { userId: "a", name: "search_chat", at: at("2026-11-02T01:03:00Z") },
    { userId: "b", name: "search_chat", at: at("2026-11-02T01:00:10Z") },
    { userId: "a", name: "search_global", at: at("2026-11-02T01:00:30Z") },
  ]
  assert.equal(sessionize(rows).length, 4)
  assert.equal(sessionize([...rows].reverse()).length, 4)
})

test("백분위", () => {
  assert.equal(percentile([], 90), null)
  assert.equal(percentile([5], 90), 5)
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9)
})

function input(over: Partial<PilotInput>): PilotInput {
  return { weeks: [new Date(MON.getTime() - 7 * 86_400_000), MON], events: [], roomDays: [], writerDays: [], queries: [], ...over }
}

test("수신율 = 기기가 받았다고 알린 수 / 푸시 서비스가 받아 간 기기 수. 받기 · 열기는 활성으로 세지 않고 열기만 센다", () => {
  const s = summarizePilot(input({
    events: [
      { userId: "a", name: "push_sent", value: 2, at: at("2026-11-02T01:00:00Z") },
      { userId: "b", name: "push_sent", value: 2, at: at("2026-11-02T01:00:00Z") },
      { userId: "a", name: "push_recv_s", value: 3, at: at("2026-11-02T01:00:03Z") },
      { userId: "a", name: "push_recv_s", value: 5, at: at("2026-11-02T01:00:05Z") },
      { userId: "b", name: "push_recv_s", value: 40, at: at("2026-11-02T01:00:40Z") },
      { userId: "a", name: "push_open_s", value: 60, at: at("2026-11-02T01:01:00Z") },
    ],
  }))
  const w = s.weeks[1]
  assert.equal(w.push.sent, 4)
  assert.equal(w.push.received, 3)
  assert.equal(w.push.receivedRate, 0.75)
  assert.equal(w.push.medianReceiveS, 5)
  assert.equal(w.push.p90ReceiveS, 40)
  assert.equal(w.push.medianOpenS, 60)
  assert.equal(w.push.opened, 1)
  assert.equal(w.activePeople, 1) // a 가 눌러 열었다. b 는 받기만 했다
  assert.equal(s.weeks[0].push.receivedRate, null)
})

test("방별 글 수와 카톡 비율 — 주마다 · 방마다. 범위 밖 날은 버린다", () => {
  const s = summarizePilot(input({
    roomDays: [
      { roomId: "r1", day: at("2026-10-27T15:00:00Z"), direct: 1, kakao: 9 },
      { roomId: "r1", day: at("2026-11-03T15:00:00Z"), direct: 6, kakao: 2 },
      { roomId: "r2", day: at("2026-11-04T15:00:00Z"), direct: 0, kakao: 2 },
      { roomId: "r2", day: at("2026-10-01T15:00:00Z"), direct: 100, kakao: 0 },
    ],
  }))
  assert.deepEqual(s.weeks.map((w) => w.messages), [
    { direct: 1, kakao: 9, kakaoShare: 0.9 },
    { direct: 6, kakao: 4, kakaoShare: 0.4 },
  ])
  assert.deepEqual(s.rooms.map((r) => [r.roomId, r.direct, r.kakao]), [["r1", 7, 11], ["r2", 0, 2]])
  assert.deepEqual(s.rooms[0].weeks, [{ direct: 1, kakao: 9 }, { direct: 6, kakao: 2 }])
})

test("활성 = 화면 기록 · 직접 쓴 글 · 옴니스 질문이 있던 날. 같은 날은 한 번", () => {
  const s = summarizePilot(input({
    events: [
      { userId: "a", name: "menu_open", value: null, at: at("2026-11-02T01:00:00Z") },
      { userId: "a", name: "room_first_message", value: 300, at: at("2026-11-02T05:00:00Z") },
      { userId: "a", name: "search_chat", value: null, at: at("2026-11-03T01:00:00Z") },
    ],
    writerDays: [{ userId: "b", day: at("2026-11-02T15:00:00Z") }],
    queries: [
      { userId: "b", at: at("2026-11-04T01:00:00Z"), photo: true },
      { userId: "c", at: at("2026-10-28T01:00:00Z"), photo: false },
    ],
  }))
  assert.equal(s.weeks[1].activePeople, 2)
  assert.equal(s.weeks[1].activePersonDays, 4) // a: 2일, b: 2일
  assert.equal(s.weeks[1].omnisAsks, 1)
  assert.equal(s.weeks[1].photoAnswers, 1)
  assert.equal(s.weeks[1].searches, 1)
  assert.equal(s.weeks[0].omnisAsks, 1)
  const byUser = Object.fromEntries(s.people.map((p) => [p.userId, p.weeks]))
  assert.deepEqual(byUser, { a: [0, 2], b: [0, 2], c: [1, 0] })
})
