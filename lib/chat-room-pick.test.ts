/** 방 고르기 규칙(list_chat view=room). 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"
import { pickByMembers, pickByRef, type PickableRoom } from "./chat-room-pick"

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
