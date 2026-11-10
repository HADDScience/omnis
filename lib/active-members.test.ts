/** 재직 구성원 판정. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"

import { ACTIVE_MEMBER_WHERE, isActiveMember, newlyChosen, personOptions } from "./active-members"

test("계정이 살아 있고 인력 표에 재직이면 재직자다", () => {
  assert.equal(isActiveMember({ isActive: true, staffProfile: { employment: "EMPLOYED" } }), true)
})

test("인력 표가 없는 계정은 isActive 만 본다", () => {
  assert.equal(isActiveMember({ isActive: true, staffProfile: null }), true)
  assert.equal(isActiveMember({ isActive: true }), true)
})

test("거부 — 비활성 계정은 재직자가 아니다(인력 표가 재직이어도)", () => {
  assert.equal(isActiveMember({ isActive: false, staffProfile: null }), false)
  assert.equal(isActiveMember({ isActive: false, staffProfile: { employment: "EMPLOYED" } }), false)
})

test("거부 — 인력 표에 퇴사면 계정이 살아 있어도 재직자가 아니다", () => {
  assert.equal(isActiveMember({ isActive: true, staffProfile: { employment: "FORMER" } }), false)
})

test("where 조각은 두 기준을 함께 건다", () => {
  assert.equal(ACTIVE_MEMBER_WHERE.isActive, true)
  assert.equal(ACTIVE_MEMBER_WHERE.NOT.staffProfile.is.employment, "FORMER")
})

test("새로 고른 사람만 재직 확인 대상이다 — 이미 담당인 퇴사자는 빠진다", () => {
  assert.deepEqual(newlyChosen(["former", "active", "new"], ["former", "active"]), ["new"])
})

test("바뀐 사람이 없으면 확인할 것도 없다 · 중복은 하나로", () => {
  assert.deepEqual(newlyChosen(["a"], ["a"]), [])
  assert.deepEqual(newlyChosen(["n", "n"], []), ["n"])
})

const active = [{ id: "a", name: "재직" }]

test("편집 후보 — 이미 걸린 퇴사자는 표시를 달아 뒤에 남는다", () => {
  assert.deepEqual(personOptions(active, [{ id: "f", name: "퇴사" }]), [
    { id: "a", name: "재직" },
    { id: "f", name: "퇴사", former: true },
  ])
})

test("이미 걸린 재직자는 표시 없이 한 번만 나온다", () => {
  assert.deepEqual(personOptions(active, [{ id: "a", name: "재직" }]), active)
})

test("담당과 지시자가 같은 퇴사자여도 한 번만 나온다", () => {
  const f = { id: "f", name: "퇴사" }
  assert.equal(personOptions(active, [f, f]).length, 2)
})

test("거부 — 이 업무에 걸리지 않은 퇴사자는 후보에 없다", () => {
  assert.deepEqual(personOptions(active, []), active)
})
