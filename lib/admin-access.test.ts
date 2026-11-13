import { test } from "node:test"
import assert from "node:assert/strict"
import { adminGate, isAdminRole } from "./admin-access"

const admin = { user: { id: "a", role: "ADMIN" } }
const member = { user: { id: "m", role: "MEMBER" } }

test("관리자만 통과한다 — 화면 · API 모두", () => {
  assert.deepEqual(adminGate(admin, "page"), { ok: true, userId: "a" })
  assert.deepEqual(adminGate(admin, "api"), { ok: true, userId: "a" })
  assert.equal(isAdminRole("ADMIN"), true)
})

test("구성원 — 화면은 404, API 는 403", () => {
  assert.deepEqual(adminGate(member, "page"), { ok: false, status: 404 })
  assert.deepEqual(adminGate(member, "api"), { ok: false, status: 403 })
})

test("로그인 안 함 — 화면은 404, API 는 401", () => {
  for (const s of [null, undefined, {}, { user: null }, { user: { role: "ADMIN" } }]) {
    assert.deepEqual(adminGate(s, "page"), { ok: false, status: 404 })
    assert.deepEqual(adminGate(s, "api"), { ok: false, status: 401 })
  }
})

test("역할 값이 비슷해도 ADMIN 이 아니면 거부 — 대소문자 · 공백 · 없음", () => {
  for (const role of ["admin", " ADMIN", "ADMIN ", "Admin", "", null, undefined, "OWNER"]) {
    assert.equal(isAdminRole(role), false, String(role))
    assert.deepEqual(adminGate({ user: { id: "x", role } }, "api"), { ok: false, status: 403 })
    assert.deepEqual(adminGate({ user: { id: "x", role } }, "page"), { ok: false, status: 404 })
  }
})
