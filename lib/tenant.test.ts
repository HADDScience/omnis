// lib/tenant.ts — 1단계 회사 껍데기. 지금은 default 하나만 돌고, 다른 회사 · 틀린 키는 거절한다
import assert from "node:assert/strict"
import { test } from "node:test"
import { DEFAULT_TENANT, currentTenant, runForTenant, tenantCacheKey } from "./tenant"

test("지금 회사는 default 다", () => {
  assert.equal(currentTenant(), "default")
  assert.equal(DEFAULT_TENANT, "default")
})

test("runForTenant(default) 는 fn 을 그대로 부르고 값을 돌려준다", async () => {
  assert.equal(await runForTenant("default", () => 42), 42)
  assert.equal(await runForTenant("default", async () => "ok"), "ok")
  await assert.rejects(runForTenant("default", async () => { throw new Error("안에서 난 오류") }), /안에서 난 오류/)
})

test("없는 회사 · 틀린 키는 fn 을 부르지 않고 거절한다", async () => {
  let called = 0
  const fn = () => { called++ }
  await assert.rejects(runForTenant("acme", fn), /아직 없다/)
  await assert.rejects(runForTenant("", fn), /형식/)
  await assert.rejects(runForTenant("Default", fn), /형식/)
  await assert.rejects(runForTenant("a b", fn), /형식/)
  assert.equal(called, 0)
})

test("캐시 키는 회사 + 정의 해시 + 코드 버전", () => {
  assert.equal(tenantCacheKey({ defHash: "abc", codeVersion: "683db8f" }), "default:abc:683db8f")
  assert.equal(tenantCacheKey({ defHash: "abc", codeVersion: "x", tenant: "t2" }), "t2:abc:x")
  assert.notEqual(tenantCacheKey({ defHash: "a", codeVersion: "1" }), tenantCacheKey({ defHash: "b", codeVersion: "1" }))
})
