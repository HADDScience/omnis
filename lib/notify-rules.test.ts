/** 푸시 받는 사람 규칙 — 방 종류별 · 끄기 · 작성자 제외 · 설정 끄기 · 일정 첫 동기화 · 업무 지정. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"

import {
  agentPushPayload,
  assignmentTargets,
  calendarEventsToNotify,
  calendarNotices,
  calendarRecipients,
  categoryOfType,
  chatPushPayload,
  chatRecipients,
  PRESENCE_WINDOW_MS,
  presenceTargets,
  pushAllowed,
  type NewCalendarEvent,
} from "./notify-rules"

const SYS = "system"
const ACTIVE = ["a", "b", "c", "d", "e"]

// ─── 종류 · 설정 ─────────────────────────────────────────

test("type → 종류: 채팅 · 업무 · 일정, 나머지는 늘 간다", () => {
  assert.equal(categoryOfType("chat_mention"), "chat")
  assert.equal(categoryOfType("task_assigned"), "task")
  assert.equal(categoryOfType("task_done_confirm"), "task")
  assert.equal(categoryOfType("calendar_event_added"), "calendar")
  assert.equal(categoryOfType("column_review"), null)
  assert.equal(categoryOfType("website_inquiry"), null)
})

test("설정: 행이 없으면 켜짐, 끈 종류만 막는다, 종류 없는 알림은 막지 않는다", () => {
  const off = { chatPush: true, taskPush: false, calendarPush: true }
  assert.equal(pushAllowed(null, "task"), true)
  assert.equal(pushAllowed(off, "task"), false)
  assert.equal(pushAllowed(off, "chat"), true)
  assert.equal(pushAllowed({ chatPush: false, taskPush: false, calendarPush: false }, null), true)
})

// ─── 쓰고 있는 기기 ──────────────────────────────────────

const NOW = new Date("2026-10-30T10:00:00Z")
const ago = (ms: number) => new Date(NOW.getTime() - ms)
const SUBS = [
  { userId: "a", endpoint: "a-phone" },
  { userId: "a", endpoint: "a-pc" },
  { userId: "b", endpoint: "b-phone" },
]
const endpoints = (subs: { endpoint: string }[]) => subs.map((s) => s.endpoint)

test("기기: 신호가 없으면 전부 보낸다", () => {
  assert.deepEqual(endpoints(presenceTargets(SUBS, [], NOW)), ["a-phone", "a-pc", "b-phone"])
})

test("기기: 구독한 PC 에서 쓰는 중이면 그 PC 로만, 다른 사람은 그대로", () => {
  const r = presenceTargets(SUBS, [{ userId: "a", activeAt: ago(60_000), endpoint: "a-pc" }], NOW)
  assert.deepEqual(endpoints(r), ["a-pc", "b-phone"])
})

test("기기: 구독하지 않은 PC 에서 쓰는 중이면 아무 기기로도 안 보낸다", () => {
  assert.deepEqual(endpoints(presenceTargets(SUBS, [{ userId: "a", activeAt: ago(0), endpoint: null }], NOW)), ["b-phone"])
  // 목록에 없는 endpoint(지워진 구독)도 같다
  assert.deepEqual(endpoints(presenceTargets(SUBS, [{ userId: "a", activeAt: ago(0), endpoint: "gone" }], NOW)), ["b-phone"])
})

test("기기: 5분이 지나면 다시 전부 보낸다(경계 포함)", () => {
  const just = presenceTargets(SUBS, [{ userId: "a", activeAt: ago(PRESENCE_WINDOW_MS - 1), endpoint: null }], NOW)
  assert.deepEqual(endpoints(just), ["b-phone"])
  const over = presenceTargets(SUBS, [{ userId: "a", activeAt: ago(PRESENCE_WINDOW_MS), endpoint: null }], NOW)
  assert.deepEqual(endpoints(over), ["a-phone", "a-pc", "b-phone"])
})

// ─── 채팅 ────────────────────────────────────────────────

test("전사방: 활성 구성원 전원에서 글쓴이를 뺀다", () => {
  const r = chatRecipients({ audience: { kind: "COMPANY", activeUserIds: ACTIVE }, authorId: "a", systemUserId: SYS, activeUserIds: ACTIVE })
  assert.deepEqual(r, ["b", "c", "d", "e"])
})

test("업무방: 담당 · 지시 · 글쓴 사람 · 즐겨찾기만, 중복 없이 — 그 밖의 구성원은 받지 않는다", () => {
  const r = chatRecipients({
    audience: { kind: "TASK", assigneeIds: ["b", "c"], instructorId: "a", threadAuthorIds: ["c", "d", "a"], favoriteUserIds: ["b"] },
    authorId: "c",
    systemUserId: SYS,
    activeUserIds: ACTIVE,
  })
  assert.deepEqual(r, ["b", "a", "d"])
  assert.ok(!r.includes("e"), "업무와 무관한 사람은 받지 않는다")
})

test("사람 1:1 · 단톡방: 참여자만", () => {
  assert.deepEqual(
    chatRecipients({ audience: { kind: "DM", memberIds: ["a", "b"] }, authorId: "a", systemUserId: SYS, activeUserIds: ACTIVE }),
    ["b"],
  )
  assert.deepEqual(
    chatRecipients({ audience: { kind: "GROUP", memberIds: ["a", "b", "c"] }, authorId: "b", systemUserId: SYS, activeUserIds: ACTIVE }),
    ["a", "c"],
  )
})

test("방을 끈 사람 · 채팅 알림을 끈 사람 · 멘션으로 이미 받는 사람은 뺀다", () => {
  const r = chatRecipients({
    audience: { kind: "COMPANY", activeUserIds: ACTIVE },
    authorId: "a",
    systemUserId: SYS,
    activeUserIds: ACTIVE,
    mutedUserIds: ["b"],
    chatOffUserIds: ["c"],
    mentionedUserIds: ["d"],
  })
  assert.deepEqual(r, ["e"])
})

test("시스템 계정 글은 아무에게도 가지 않는다 · 시스템 계정은 받지 않는다 · 떠난 사람은 받지 않는다", () => {
  assert.deepEqual(
    chatRecipients({ audience: { kind: "COMPANY", activeUserIds: ACTIVE }, authorId: SYS, systemUserId: SYS, activeUserIds: ACTIVE }),
    [],
  )
  const r = chatRecipients({
    audience: { kind: "GROUP", memberIds: ["a", SYS, "gone"] },
    authorId: "b",
    systemUserId: SYS,
    activeUserIds: ACTIVE,
  })
  assert.deepEqual(r, ["a"])
})

test("채팅 푸시 내용: 1:1 은 보낸 사람이 제목, 나머지는 방 이름 + 「보낸 사람: 앞부분」, 방마다 tag 하나", () => {
  const dm = chatPushPayload({ room: { kind: "DM", id: "r1", name: "정우창, 김하드" }, authorName: "김하드", content: "안녕\n\n내일 봬요" })
  assert.equal(dm.title, "김하드")
  assert.equal(dm.body, "안녕 내일 봬요")
  assert.equal(dm.url, "/chat/r1")
  assert.equal(dm.tag, "omnis:chat:room:r1")
  const task = chatPushPayload({ room: { kind: "TASK", id: "t1", name: "시약 주문" }, authorName: "김하드", content: "x".repeat(100) })
  assert.equal(task.title, "# 시약 주문")
  assert.equal(task.roomPath, "/chat/task/t1")
  assert.equal(task.tag, "omnis:chat:task:t1")
  assert.ok(task.body.startsWith("김하드: "))
  assert.ok(task.body.endsWith("…") && task.body.length <= "김하드: ".length + 61)
})

test("옴니스 답 푸시: 확인 카드는 「확인이 필요해요」, 답은 마크다운 기호를 뗀 앞부분", () => {
  const a = agentPushPayload({ roomId: "o1", roomName: "마감 정리", kind: "approval" })
  assert.ok(a.body.startsWith("확인이 필요해요"))
  assert.equal(a.roomPath, "/chat/o1")
  const b = agentPushPayload({ roomId: "o1", roomName: "마감 정리", kind: "answer", text: "**이번 주** 마감은 3건입니다" })
  assert.equal(b.body, "이번 주 마감은 3건입니다")
})

// ─── 업무 지정 ───────────────────────────────────────────

test("업무 지정: 자기 지정 제외 · 중복 한 번 · 이미 담당이던 사람 제외 · 시스템 계정 제외", () => {
  assert.deepEqual(assignmentTargets({ previous: [], next: ["a", "b", "b", SYS], actorId: "a", systemUserId: SYS }), ["b"])
  assert.deepEqual(assignmentTargets({ previous: ["b"], next: ["b", "c"], actorId: "a", systemUserId: SYS }), ["c"])
  assert.deepEqual(assignmentTargets({ previous: ["b", "c"], next: ["c", "b"], actorId: "a", systemUserId: SYS }), [], "순서만 바꾸면 아무도 받지 않는다")
  assert.deepEqual(assignmentTargets({ previous: [], next: ["a"], actorId: "a", systemUserId: SYS }), [], "나만 맡으면 아무도 받지 않는다")
})

// ─── 일정 ────────────────────────────────────────────────

const now = new Date("2026-10-29T03:00:00Z")
function ev(p: Partial<NewCalendarEvent> & { id: string }): NewCalendarEvent {
  return {
    recurrenceId: "",
    summary: p.id,
    startAt: new Date("2026-11-03T05:00:00Z"),
    endAt: new Date("2026-11-03T06:00:00Z"),
    isAllDay: false,
    rrule: null,
    recurUntil: null,
    status: "CONFIRMED",
    organizer: null,
    ...p,
  }
}

test("일정: 캘린더 첫 동기화에는 하나도 알리지 않는다", () => {
  assert.deepEqual(calendarEventsToNotify({ firstSync: true, created: [ev({ id: "x" })], now }), [])
})

test("일정: 마스터만 · 취소 · 끝난 일정 제외 · 끝없는 반복과 아직 안 끝난 반복은 알린다 · 시작 순", () => {
  const created = [
    ev({ id: "later", startAt: new Date("2026-11-10T00:00:00Z"), endAt: new Date("2026-11-10T01:00:00Z") }),
    ev({ id: "exception", recurrenceId: "2026-11-05T00:00:00.000Z" }),
    ev({ id: "cancelled", status: "CANCELLED" }),
    ev({ id: "past", startAt: new Date("2026-10-01T00:00:00Z"), endAt: new Date("2026-10-01T01:00:00Z") }),
    ev({ id: "weekly", startAt: new Date("2026-09-01T00:00:00Z"), endAt: new Date("2026-09-01T01:00:00Z"), rrule: "FREQ=WEEKLY", recurUntil: null }),
    ev({ id: "ended-series", startAt: new Date("2026-09-01T00:00:00Z"), endAt: new Date("2026-09-01T01:00:00Z"), rrule: "FREQ=WEEKLY", recurUntil: new Date("2026-10-01T00:00:00Z") }),
    ev({ id: "soon" }),
  ]
  assert.deepEqual(calendarEventsToNotify({ firstSync: false, created, now }).map((e) => e.id), ["weekly", "soon", "later"])
})

test("일정 받는 사람: ALL 은 전원 · ADMIN 은 관리자만 · 주최자 · 시스템 계정 제외", () => {
  const users = [
    { id: "a", role: "ADMIN", email: "boss@hadd.com" },
    { id: "b", role: "MEMBER", email: "B@hadd.com" },
    { id: SYS, role: "ADMIN", email: null },
  ]
  assert.deepEqual(calendarRecipients({ audience: "ALL", users, organizer: null, systemUserId: SYS }), ["a", "b"])
  assert.deepEqual(calendarRecipients({ audience: "ADMIN", users, organizer: null, systemUserId: SYS }), ["a"])
  assert.deepEqual(calendarRecipients({ audience: "ALL", users, organizer: "mailto:b@hadd.com", systemUserId: SYS }), ["a"])
})

test("일정 알림 내용: 그 날짜로 가는 entityId · 4건 이상이면 하나로 묶는다", () => {
  const one = calendarNotices("회사 일정", [ev({ id: "e1", summary: "주간회의" })])
  assert.equal(one.length, 1)
  assert.equal(one[0].entityId, "2026-11-03:e1")
  assert.equal(one[0].title, "새 일정: 주간회의")
  assert.ok(one[0].content.startsWith("회사 일정 · 11월 3일"))
  const many = calendarNotices("회사 일정", ["1", "2", "3", "4", "5"].map((id) => ev({ id })))
  assert.equal(many.length, 1)
  assert.equal(many[0].title, "새 일정 5건 · 회사 일정")
  assert.ok(many[0].content.endsWith("외 2건"))
  assert.equal(calendarNotices("회사 일정", ["1", "2", "3"].map((id) => ev({ id }))).length, 3)
})
