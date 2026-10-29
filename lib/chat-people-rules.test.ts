/**
 * 사람끼리 대화(5단계) 규칙. 실행: pnpm test:unit
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { defaultGroupName, dmKeyOf, mentionedMembers, peopleRoomTitle, planPeopleRoom, PEOPLE_PICK_MAX, PEOPLE_ROOM_NAME_MAX } from "./chat-people-rules"

const active = new Set(["me", "a", "b", "c"])

test("1:1 열쇠는 순서와 상관없이 같다 — 같은 두 사람의 방이 하나뿐이게", () => {
  assert.equal(dmKeyOf("a", "b"), dmKeyOf("b", "a"))
  assert.notEqual(dmKeyOf("a", "b"), dmKeyOf("a", "c"))
})

test("1명을 고르면 1:1, 2명 이상이면 단톡방(나를 넣어서)", () => {
  assert.deepEqual(planPeopleRoom("me", ["a"], active), { kind: "DM", otherId: "a" })
  assert.deepEqual(planPeopleRoom("me", ["a", "b"], active), { kind: "GROUP", memberIds: ["me", "a", "b"] })
})

test("나 자신 · 중복은 뺀다 — 나와 a 를 고르면 a 와의 1:1", () => {
  assert.deepEqual(planPeopleRoom("me", ["me", "a", "a"], active), { kind: "DM", otherId: "a" })
})

test("거부되어야 하는 경우 — 아무도 안 고름 · 나만 고름 · 없는 사람 · 상한 초과", () => {
  assert.ok("error" in planPeopleRoom("me", [], active))
  assert.ok("error" in planPeopleRoom("me", ["me"], active))
  assert.ok("error" in planPeopleRoom("me", ["a", "system"], active), "시스템 계정 · 퇴사자는 고를 수 없다")
  const many = Array.from({ length: PEOPLE_PICK_MAX + 1 }, (_, i) => `u${i}`)
  assert.ok("error" in planPeopleRoom("me", many, new Set(many)))
})

test("단톡방 기본 이름은 참여자 이름을 잇고 나는 맨 뒤 · 길면 「외 N명」", () => {
  assert.equal(defaultGroupName(["김아리", "윤훈"], "정우창"), "김아리, 윤훈, 정우창")
  const long = defaultGroupName(Array.from({ length: 12 }, (_, i) => `구성원${i + 1}`), "정우창")
  assert.ok(long.length <= PEOPLE_ROOM_NAME_MAX, long)
  assert.match(long, /외 \d+명$/)
})

test("1:1 이름은 보는 사람마다 상대 이름 · 단톡방은 저장한 이름", () => {
  const members = [{ id: "me", name: "정우창" }, { id: "a", name: "김아리" }]
  assert.equal(peopleRoomTitle({ kind: "DM", name: "정우창, 김아리" }, members, "me"), "김아리")
  assert.equal(peopleRoomTitle({ kind: "DM", name: "정우창, 김아리" }, members, "a"), "정우창")
  assert.equal(peopleRoomTitle({ kind: "GROUP", name: "견적팀" }, members, "me"), "견적팀")
})

test("멘션 알림은 그 방 참여자에게만 — 방 밖 사람 · 나 자신은 받지 않는다", () => {
  const members = [{ id: "me", name: "정우창" }, { id: "a", name: "김아리" }]
  assert.deepEqual(mentionedMembers("@김아리 확인 부탁", members, "me"), ["a"])
  assert.deepEqual(mentionedMembers("@윤훈 이것 좀", members, "me"), [], "참여자가 아니면 이름이 맞아도 받지 않는다 (거부되어야 하는 경우)")
  assert.deepEqual(mentionedMembers("@정우창 메모", members, "me"), [], "나 자신에게는 보내지 않는다")
  assert.deepEqual(mentionedMembers("@김아리님 @김아리 두 번", members, "me"), ["a"], "같은 사람은 한 번")
})

test("이름이 겹치면 긴 이름부터 — 「@김철수」 를 「김철」 로 잡지 않는다", () => {
  const members = [{ id: "me", name: "나" }, { id: "s", name: "김철" }, { id: "l", name: "김철수" }]
  assert.deepEqual(mentionedMembers("@김철수 확인", members, "me"), ["l"])
  assert.deepEqual(mentionedMembers("@김철 확인", members, "me"), ["s"])
})
