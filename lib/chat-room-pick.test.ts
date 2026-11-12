/** 방 고르기 규칙(list_chat view=room). 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"
import { isSelfAlias, pickByMembers, pickByRef, pickPostTarget, selfRoomOf, type PickableRoom } from "./chat-room-pick"

const me = { id: "u-me", name: "정우창" }
const ari = { id: "u-ari", name: "김아리" }
const hye = { id: "u-hye", name: "노혜린" }
const kim = { id: "u-kim", name: "김철수" }
const at = (n: number) => new Date(Date.UTC(2026, 10, n))

const rooms: PickableRoom[] = [
  { id: "company", kind: "COMPANY", title: "전체", members: [], lastAt: at(5) },
  { id: "intern", kind: "GROUP", title: "김아리, 노혜린, 정우창", members: [ari, hye, me], lastAt: at(4) },
  { id: "dm-ari", kind: "DM", title: "김아리", members: [me, ari], lastAt: at(3) },
  { id: "self", kind: "DM", title: "나와의 대화", members: [me], lastAt: at(2) },
  { id: "big", kind: "GROUP", title: "연구팀", members: [me, ari, hye, kim], lastAt: at(1) },
]

test("ID 가 정확히 맞으면 그 방 하나", () => {
  assert.deepEqual(pickByRef(rooms, "dm-ari").map((r) => r.id), ["dm-ari"])
})

test("이름 일부 — 공백 · 대소문자 무시, 최근 글 순", () => {
  assert.deepEqual(pickByRef(rooms, "노혜린,정우창").map((r) => r.id), ["intern"])
  assert.deepEqual(pickByRef(rooms, "김아리").map((r) => r.id), ["intern", "dm-ari"])
  assert.deepEqual(pickByRef(rooms, "  ").map((r) => r.id), [])
})

test("참여자 — 정확히 그 구성만. 나는 넣어도 빼도 같다", () => {
  assert.deepEqual(pickByMembers(rooms, ["김아리", "노혜린"], me.id).map((r) => r.id), ["intern"])
  assert.deepEqual(pickByMembers(rooms, ["김아리", "노혜린", "정우창"], me.id).map((r) => r.id), ["intern"])
  assert.deepEqual(pickByMembers(rooms, ["김아리"], me.id).map((r) => r.id), ["dm-ari"])
  // 더 큰 방(연구팀)은 구성이 달라 걸리지 않는다
  assert.ok(!pickByMembers(rooms, ["김아리", "노혜린"], me.id).some((r) => r.id === "big"))
})

test("호칭을 떼고 맞춘다", () => {
  assert.deepEqual(pickByMembers(rooms, ["김아리님", "노혜린 씨".replace(" ", "")], me.id).map((r) => r.id), ["intern"])
})

test("나만 고르면 나와의 대화", () => {
  assert.deepEqual(pickByMembers(rooms, ["정우창"], me.id).map((r) => r.id), ["self"])
})

test("한 이름이 두 참여자에 걸리면 고르지 않는다", () => {
  // 「김」 은 두 글자 미만, 「김아」 는 김아리 하나 — 연구팀에서 「김」 은 김아리 · 김철수 둘에 걸린다
  assert.deepEqual(pickByMembers(rooms, ["김"], me.id), [])
  assert.deepEqual(pickByMembers(rooms, ["노혜린", "김아", "김철"], me.id).map((r) => r.id), ["big"])
})

test("전사방은 참여자로 고르지 않는다", () => {
  assert.ok(!pickByMembers(rooms, ["김아리"], me.id).some((r) => r.kind === "COMPANY"))
})

test("내가 없는 방은 넘겨받아도 참여자로 고르지 않는다", () => {
  const foreign: PickableRoom = { id: "foreign", kind: "GROUP", title: "남의 방", members: [ari, hye], lastAt: at(9) }
  assert.deepEqual(pickByMembers([foreign], ["김아리", "노혜린"], me.id), [])
})

// ─── 글 보내기 대상(post_message room) ───

test("보낼 방: 비우거나 전사방이라고 하면 전사방", () => {
  for (const ref of [undefined, "", "  ", "전사방", "company", "default-room", "전체"]) {
    assert.deepEqual(pickPostTarget(rooms, ref, me.id), { kind: "company" }, String(ref))
  }
})

test("보낼 방: me · 나와의 대화 · self 는 나만 있는 1:1", () => {
  for (const ref of ["me", "ME", "self", "나", "나와의 대화", "나와의대화"]) {
    const t = pickPostTarget(rooms, ref, me.id)
    assert.equal(t.kind, "self", ref)
    assert.equal(t.kind === "self" && t.room?.id, "self", ref)
  }
  // 아직 연 적이 없으면 room 이 비어 온다 — 부르는 쪽이 연다
  const none = pickPostTarget(rooms.filter((r) => r.id !== "self"), "나와의 대화", me.id)
  assert.deepEqual(none, { kind: "self", room: null })
  assert.equal(isSelfAlias("나 와의 대화"), true)
  assert.equal(isSelfAlias("나랑 김아리"), false)
})

test("보낼 방: 방 ID 를 그대로 줘도 나와의 대화로 안다", () => {
  assert.equal(pickPostTarget(rooms, "self", me.id).kind, "self")
  assert.equal(selfRoomOf(rooms, me.id)?.id, "self")
  // 남의 「나와의 대화」 는 내 것이 아니다 — 참여자가 나 하나인 방만
  assert.equal(selfRoomOf([{ id: "x", kind: "DM", title: "나와의 대화", members: [ari], lastAt: at(1) }], me.id), null)
})

test("보낼 방: 이름 하나에 맞으면 그 방, 여럿이면 고르지 않고 후보를 돌려준다", () => {
  const one = pickPostTarget(rooms, "연구팀", me.id)
  assert.equal(one.kind === "room" && one.room.id, "big")
  const many = pickPostTarget(rooms, "김아리", me.id)
  assert.equal(many.kind, "many")
  assert.deepEqual(many.kind === "many" && many.rooms.map((r) => r.id), ["intern", "dm-ari"])
  assert.equal(pickPostTarget(rooms, "dm-ari", me.id).kind, "room")
})

test("보낼 방: 없는 방 · 남의 방 ID 는 없음과 같다", () => {
  assert.deepEqual(pickPostTarget(rooms, "없는방", me.id), { kind: "none" })
  assert.deepEqual(pickPostTarget(rooms, "someone-elses-room-id", me.id), { kind: "none" })
})

test("보낼 방: 옴니스 1:1 은 따로 알린다(글 보내기가 아니라 ask_omnis)", () => {
  const withOmnis = [...rooms, { id: "omnis-1", kind: "OMNIS_DM", title: "옴니스", members: [], lastAt: at(6) }]
  assert.equal(pickPostTarget(withOmnis, "omnis-1", me.id).kind, "omnis")
})
