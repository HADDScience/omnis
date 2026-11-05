/** 사용 기록 규칙 — 내용 비수집 · 경로 지우기 · 설문 대상 · 집계. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"

import {
  isRoomPattern,
  kstDayStart,
  median,
  pathPattern,
  pickSurveyTarget,
  retentionCutoff,
  summarize,
  uiEventBatchSchema,
  uiSurveyAnswerSchema,
} from "./rules"

const SHA = "abcdef1"
const good = { sha: SHA, events: [{ name: "menu_open", path: "/chat/:id" }] }

test("방을 누른 뒤 첫 글 시간은 저장본 여부를 나눠 중앙값을 낸다", () => {
  const at = new Date("2026-11-05T00:00:00Z")
  const rows = summarize({
    events: [
      { commitSha: "abc1234", userId: "a", name: "room_first_message", value: 100, at },
      { commitSha: "abc1234", userId: "a", name: "room_first_message", value: 300, at },
      { commitSha: "abc1234", userId: "b", name: "room_first_message_saved", value: 50, at },
    ],
    responses: [],
    names: new Map(),
  })
  assert.equal(rows[0].firstMessageMs, 200)
  assert.equal(rows[0].firstMessageSavedMs, 50)
  assert.equal(rows[0].people.find((p) => p.userId === "b")?.firstMessageMs, null)
})

test("이름 · 숫자 · 경로만 받는다", () => {
  assert.ok(uiEventBatchSchema.safeParse(good).success)
  assert.ok(uiEventBatchSchema.safeParse({ sha: SHA, events: [{ name: "room_open_to_send", value: 1200, path: "/chat/:id" }] }).success)
})

test("내용을 실을 칸이 있는 요청은 통째로 거절한다", () => {
  for (const extra of ["content", "message", "fileName", "roomName", "title", "userId"]) {
    const withEvent = { sha: SHA, events: [{ name: "menu_open", path: "/", [extra]: "비밀" }] }
    assert.equal(uiEventBatchSchema.safeParse(withEvent).success, false, `event.${extra}`)
    assert.equal(uiEventBatchSchema.safeParse({ ...good, [extra]: "비밀" }).success, false, `batch.${extra}`)
  }
})

test("목록에 없는 이름 · 글자 값 · 범위 밖 값 · 커밋이 아닌 sha 를 거절한다", () => {
  const cases = [
    { sha: SHA, events: [{ name: "내 메시지 내용", path: "/" }] },
    { sha: SHA, events: [{ name: "shortcut.비밀", path: "/" }] },
    { sha: SHA, events: [{ name: "menu_open", value: "글자", path: "/" }] },
    { sha: SHA, events: [{ name: "menu_open", value: 1.5, path: "/" }] },
    { sha: SHA, events: [{ name: "menu_open", value: -1, path: "/" }] },
    { sha: "회의록.pdf", events: [{ name: "menu_open", path: "/" }] },
    { sha: SHA, events: [] },
    { sha: SHA, events: Array(41).fill({ name: "menu_open", path: "/" }) },
  ]
  for (const c of cases) assert.equal(uiEventBatchSchema.safeParse(c).success, false, JSON.stringify(c).slice(0, 60))
})

test("경로에서 ID · 슬러그 · 이름 · 질의문자를 지운다", () => {
  assert.equal(pathPattern("/chat/default-room"), "/chat/:id")
  assert.equal(pathPattern("/chat/task/46091728-1a69-4fa8-9fb8-0a6056e7cc0d?q=비밀#x"), "/chat/task/:id")
  assert.equal(pathPattern("/tasks/고객사-견적-업무"), "/tasks/:id")
  assert.equal(pathPattern("/omnis/회의록.pdf"), "/omnis/:id")
  assert.equal(pathPattern("/모르는화면/비밀"), "/:id/:id")
  assert.equal(pathPattern("/settings/ui-metrics"), "/settings/ui-metrics")
  assert.equal(pathPattern("/"), "/")
})

test("첫 전송은 방 화면에서만 잰다", () => {
  assert.ok(isRoomPattern(pathPattern("/chat/room-1")))
  assert.ok(isRoomPattern(pathPattern("/chat/task/t1")))
  assert.equal(isRoomPattern(pathPattern("/chat")), false)
  assert.equal(isRoomPattern(pathPattern("/chat/new")), false)
  assert.equal(isRoomPattern(pathPattern("/chat/new/people")), false)
  assert.equal(isRoomPattern(pathPattern("/tasks/t1")), false)
})

test("설문 답 — 1~5 또는 닫음, 한 줄, 모르는 칸 거절", () => {
  assert.ok(uiSurveyAnswerSchema.safeParse({ sha: SHA, score: 5, comment: "좋아요" }).success)
  assert.ok(uiSurveyAnswerSchema.safeParse({ sha: SHA, score: null }).success)
  for (const bad of [
    { sha: SHA, score: 0 },
    { sha: SHA, score: 6 },
    { sha: SHA, score: 2.5 },
    { sha: SHA, score: 3, comment: "둘째\n줄" },
    { sha: SHA, score: 3, comment: "가".repeat(141) },
    { sha: SHA, score: 3, roomName: "비밀" },
    { sha: SHA },
  ]) assert.equal(uiSurveyAnswerSchema.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 50))
})

const at = (s: string) => new Date(`${s}+09:00`)
const pick = (over: Partial<Parameters<typeof pickSurveyTarget>[0]>) =>
  pickSurveyTarget({
    deployments: [{ sha: SHA, firstSeenAt: at("2026-11-03T15:00:00") }],
    usedShas: new Set([SHA]),
    answeredShas: new Set(),
    now: at("2026-11-04T09:00:00"),
    ...over,
  })

test("배포 다음 날(한국 시간)부터 묻는다", () => {
  assert.equal(pick({ now: at("2026-11-03T23:59:00") }), null)
  assert.equal(pick({ now: at("2026-11-04T00:00:00") }), SHA)
})

test("한 번 답하거나 닫으면 다시 묻지 않고, 옛 배포로 넘어가지 않는다", () => {
  const old = { sha: "1111111", firstSeenAt: at("2026-11-02T10:00:00") }
  const deployments = [old, { sha: SHA, firstSeenAt: at("2026-11-03T15:00:00") }]
  const usedShas = new Set([old.sha, SHA])
  assert.equal(pick({ deployments, usedShas }), SHA)
  assert.equal(pick({ deployments, usedShas, answeredShas: new Set([SHA]) }), null)
})

test("써 보지 않은 배포 · 오늘 나온 배포 · 로컬 빌드 · 오래된 배포는 묻지 않는다", () => {
  assert.equal(pick({ usedShas: new Set() }), null)
  assert.equal(pick({ deployments: [{ sha: SHA, firstSeenAt: at("2026-11-04T08:00:00") }] }), null)
  assert.equal(pick({ deployments: [{ sha: "dev", firstSeenAt: at("2026-11-01T08:00:00") }], usedShas: new Set(["dev"]) }), null)
  assert.equal(pick({ now: at("2026-11-11T09:00:00") }), null)
})

test("오늘 나온 새 배포가 있어도 어제 배포를 묻는다 — 매일 배포해도 끊기지 않는다", () => {
  const deployments = [
    { sha: SHA, firstSeenAt: at("2026-11-03T15:00:00") },
    { sha: "2222222", firstSeenAt: at("2026-11-04T08:00:00") },
  ]
  assert.equal(pick({ deployments, usedShas: new Set([SHA, "2222222"]) }), SHA)
})

test("한국 날짜 경계와 보존 기한", () => {
  assert.equal(kstDayStart(at("2026-11-04T00:30:00")).toISOString(), at("2026-11-04T00:00:00").toISOString())
  assert.equal(kstDayStart(at("2026-11-03T23:30:00")).toISOString(), at("2026-11-03T00:00:00").toISOString())
  assert.equal(retentionCutoff(new Date("2026-11-04T00:00:00Z")).toISOString(), "2026-08-06T00:00:00.000Z")
})

test("중앙값 — 비었을 때 · 홀수 · 짝수", () => {
  assert.equal(median([]), null)
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([1, 2, 3, 10]), 3)
})

test("배포별 · 사람별로 묶는다", () => {
  const ev = (commitSha: string, userId: string, name: string, value: number | null = null, when = "2026-11-03T10:00:00") => ({ commitSha, userId, name, value, at: at(when) })
  const rows = summarize({
    events: [
      ev(SHA, "a", "room_open_to_send", 1000),
      ev(SHA, "a", "room_open_to_send", 3000),
      ev(SHA, "b", "room_open_to_send", 9000),
      ev(SHA, "b", "plus_open"),
      ev(SHA, "b", "plus_dismiss"),
      ev(SHA, "b", "attach_failed", 500),
      ev(SHA, "b", "shortcut.commandPalette"),
      ev("1111111", "a", "menu_open", null, "2026-11-01T10:00:00"),
    ],
    responses: [
      { commitSha: SHA, userId: "a", score: 4, comment: "좋음", createdAt: at("2026-11-04T09:00:00") },
      { commitSha: SHA, userId: "b", score: null, comment: null, createdAt: at("2026-11-04T09:00:00") },
    ],
    names: new Map([["a", "가"], ["b", "나"]]),
  })
  assert.deepEqual(rows.map((r) => r.sha), [SHA, "1111111"])
  const d = rows[0]
  assert.equal(d.medianMs, 3000)
  assert.equal(d.sends, 3)
  assert.equal(d.medianScore, 4)
  assert.equal(d.answers, 1)
  assert.equal(d.dismissals, 1)
  assert.equal(d.counts.plusDismiss, 1)
  assert.equal(d.counts.shortcut, 1)
  const [a, b] = d.people
  assert.equal(a.name, "가")
  assert.equal(a.medianMs, 2000)
  assert.equal(a.comment, "좋음")
  assert.equal(b.dismissed, true)
  assert.equal(b.counts.attachFailed, 1)
})
