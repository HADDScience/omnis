import { test } from "node:test"
import assert from "node:assert/strict"
import { PASSWORD_SNOOZE_DAYS, passwordNotice } from "./password-notice"

const day = 86_400_000
const t0 = new Date("2026-11-01T00:00:00Z")
const at = (days: number) => new Date(t0.getTime() + days * day)

test("기록이 없거나 본인이 바꿨으면 해결 — 점도 안내도 없다", () => {
  assert.deepEqual(passwordNotice([], at(0)), { pending: false, showNotice: false, snoozedUntil: null })
  const logs = [
    { action: "reset", createdAt: at(0) },
    { action: "changed", createdAt: at(1) },
  ]
  assert.deepEqual(passwordNotice(logs, at(2)), { pending: false, showNotice: false, snoozedUntil: null })
})

test("관리자가 정한 비밀번호를 쓰는 동안 안내 · 점", () => {
  const r = passwordNotice([{ action: "reset", createdAt: at(0) }], at(3))
  assert.deepEqual(r, { pending: true, showNotice: true, snoozedUntil: null })
})

test("「나중에」 는 7일 동안 안내만 숨기고 점은 남긴다 — 7일이 지나면 다시 뜬다", () => {
  const logs = [
    { action: "reset", createdAt: at(0) },
    { action: "snoozed", createdAt: at(1) },
  ]
  const during = passwordNotice(logs, at(1 + PASSWORD_SNOOZE_DAYS - 0.01))
  assert.equal(during.pending, true)
  assert.equal(during.showNotice, false)
  assert.deepEqual(during.snoozedUntil, at(1 + PASSWORD_SNOOZE_DAYS))
  const after = passwordNotice(logs, at(1 + PASSWORD_SNOOZE_DAYS))
  assert.deepEqual(after, { pending: true, showNotice: true, snoozedUntil: null })
})

test("가장 최근 「나중에」 부터 센다 · 순서가 섞여 와도 같다", () => {
  const logs = [
    { action: "snoozed", createdAt: at(9) },
    { action: "reset", createdAt: at(0) },
    { action: "snoozed", createdAt: at(1) },
  ]
  const r = passwordNotice(logs, at(12))
  assert.equal(r.showNotice, false)
  assert.deepEqual(r.snoozedUntil, at(16))
})

test("「나중에」 뒤에 다시 초기화되면 안내가 바로 다시 뜬다", () => {
  const logs = [
    { action: "reset", createdAt: at(0) },
    { action: "snoozed", createdAt: at(1) },
    { action: "reset", createdAt: at(2) },
  ]
  assert.deepEqual(passwordNotice(logs, at(3)), { pending: true, showNotice: true, snoozedUntil: null })
})

test("바꾼 뒤 남은 「나중에」 는 무시한다", () => {
  const logs = [
    { action: "reset", createdAt: at(0) },
    { action: "snoozed", createdAt: at(1) },
    { action: "changed", createdAt: at(2) },
  ]
  assert.equal(passwordNotice(logs, at(3)).pending, false)
})
