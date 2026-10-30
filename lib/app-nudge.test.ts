/** 앱 설치 · 기기 알림 권유 규칙. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"

import { decideNudge, type NudgeInput } from "./app-nudge"

const none = { install: false, push: false }
const browser: NudgeInput = {
  standalone: false,
  off: none,
  later: none,
  pushSupported: true,
  pushConfigured: true,
  permission: "default",
  subscribed: false,
  automated: false,
}
const app: NudgeInput = { ...browser, standalone: true }

test("설치 전 — 설치를 권한다. 「더 이상 안 보기」 · 이번 접속 「다음에」 면 거부", () => {
  assert.equal(decideNudge(browser), "install")
  assert.equal(decideNudge({ ...browser, off: { ...none, install: true } }), null)
  assert.equal(decideNudge({ ...browser, later: { ...none, install: true } }), null)
  // 알림 쪽 「더 이상 안 보기」 는 설치 권유를 막지 않는다
  assert.equal(decideNudge({ ...browser, off: { ...none, push: true } }), "install")
})

test("설치 뒤 — 알림을 권한다. 설치 권유를 껐어도 알림은 따로 묻는다", () => {
  assert.equal(decideNudge(app), "push")
  assert.equal(decideNudge({ ...app, off: { ...none, install: true } }), "push")
  // 권한은 있는데 구독이 없다(다른 브라우저 데이터 정리 등) — 다시 권한다
  assert.equal(decideNudge({ ...app, permission: "granted", subscribed: false }), "push")
})

test("알림 권유를 띄우지 않는 경우 (거부되어야 하는 경우 전부)", () => {
  assert.equal(decideNudge({ ...app, off: { ...none, push: true } }), null)
  assert.equal(decideNudge({ ...app, later: { ...none, push: true } }), null)
  assert.equal(decideNudge({ ...app, permission: "granted", subscribed: true }), null)
  assert.equal(decideNudge({ ...app, permission: "denied" }), null)
  assert.equal(decideNudge({ ...app, pushSupported: false }), null)
  assert.equal(decideNudge({ ...app, pushConfigured: false }), null)
})

test("자동화 브라우저에는 어느 것도 띄우지 않는다", () => {
  assert.equal(decideNudge({ ...browser, automated: true }), null)
  assert.equal(decideNudge({ ...app, automated: true }), null)
})
