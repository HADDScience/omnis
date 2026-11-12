/** 옴니스 세션 공유 · 해제 · 인계 규칙. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"

import { hasRobotMark, stripRobotMark } from "./robot-mark"
import { handoverRefusal, planPersonShare, planRoomSync, planUnshare, shareNoticeText, sharedLabel, shareNotification, type SessionMemberRow } from "./omnis-session-share-rules"

const rows: SessionMemberRow[] = [
  { userId: "owner", shareKind: null },
  { userId: "p1", shareKind: "PERSON" },
  { userId: "r1", shareKind: "ROOM" },
  { userId: "r2", shareKind: "ROOM" },
]

test("사람 공유 — 새 사람은 넣고, 방으로 들어온 사람은 사람 공유로 바꾸고, 주인 · 이미 공유된 사람은 건너뛴다", () => {
  assert.deepEqual(planPersonShare(rows, "owner", ["new", "r1", "p1", "owner", "new", ""]), { add: ["new"], upgrade: ["r1"] })
})

test("방 동기화 — ROOM 행만 넣고 뺀다. 주인 · 사람 공유는 방을 나가도 남는다", () => {
  assert.deepEqual(planRoomSync(rows, ["r1", "x", "p1"]), { remove: ["r2"], add: ["x"] })
  assert.deepEqual(planRoomSync(rows, []), { remove: ["r1", "r2"], add: [] })
})

test("공유 해제 — 한 사람 · 방 · 모두. 주인은 지우지 않는다", () => {
  assert.deepEqual(planUnshare(rows, { userId: "p1" }), ["p1"])
  // 방으로 들어온 사람은 사람 해제로 빠지지 않는다 — 방 공유를 풀어야 빠진다
  assert.deepEqual(planUnshare(rows, { userId: "r1" }), [])
  assert.deepEqual(planUnshare(rows, { room: true }), ["r1", "r2"])
  assert.deepEqual(planUnshare(rows, { all: true }), ["p1", "r1", "r2"])
})

test("인계 — 주인만, 다른 사람에게, 시스템 계정은 안 된다", () => {
  const base = { actorId: "a", ownerId: "a", toId: "b", systemUserId: "system" }
  assert.equal(handoverRefusal(base), null)
  assert.match(handoverRefusal({ ...base, actorId: "b" })!, /연 사람만/)
  assert.match(handoverRefusal({ ...base, toId: "a" })!, /다른 사람/)
  assert.match(handoverRefusal({ ...base, toId: "system" })!, /시스템/)
})

test("공유 표시 — 방 공유면 방 이름, 받은 사람에게는 주인 이름, 내 개인 세션은 없음", () => {
  assert.equal(sharedLabel({ viewerId: "b", ownerId: "a", ownerName: "팀장", originTitle: "주간 회의" }), "주간 회의")
  assert.equal(sharedLabel({ viewerId: "b", ownerId: "a", ownerName: "팀장", originTitle: null }), "팀장님")
  assert.equal(sharedLabel({ viewerId: "a", ownerId: "a", ownerName: "팀장", originTitle: null }), null)
})

test("안내 · 알림 문구 — 방 안내는 옴니스 표식으로 시작하고 화면은 그 표식을 아이콘으로 바꾼다", () => {
  assert.equal(shareNoticeText("팀장"), "🤖 팀장님이 옴니스 대화를 공유했어요")
  assert.equal(hasRobotMark(shareNoticeText("팀장")), true)
  assert.equal(stripRobotMark(shareNoticeText("팀장")), "팀장님이 옴니스 대화를 공유했어요")
  assert.deepEqual(shareNotification({ sharerName: "팀장", sessionName: "마감 정리" }), { title: "팀장님이 옴니스 대화를 공유했어요", content: "마감 정리" })
  assert.equal(shareNotification({ sharerName: "팀장", sessionName: "x", handover: true }).title, "팀장님이 옴니스 대화를 넘겼어요")
})
