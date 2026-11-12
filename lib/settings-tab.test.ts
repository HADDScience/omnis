/** 마이 화면 탭 주소 값. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"

import { legacySettingsRedirect, resolveSettingsTab, UI_METRICS_NOTICE_HREF } from "./settings-tab"

test("아는 탭은 그대로, 모르는 값 · 없는 값은 첫 탭", () => {
  assert.equal(resolveSettingsTab("info"), "info")
  assert.equal(resolveSettingsTab("usage"), "usage")
  assert.equal(resolveSettingsTab("notify"), "notify")
  assert.equal(resolveSettingsTab("general"), "general")
  assert.equal(resolveSettingsTab("nope"), "general")
  assert.equal(resolveSettingsTab("INFO"), "general")
  assert.equal(resolveSettingsTab(""), "general")
  assert.equal(resolveSettingsTab(null), "general")
  assert.equal(resolveSettingsTab(undefined), "general")
})

test("옛 탭 값은 같은 내용의 새 탭으로, 연결된 계정은 프로필 설정으로", () => {
  assert.equal(resolveSettingsTab("push"), "notify")
  assert.equal(resolveSettingsTab("ai"), "usage")
  assert.equal(resolveSettingsTab("system"), "info")
  assert.equal(legacySettingsRedirect("push"), "/settings?tab=notify")
  assert.equal(legacySettingsRedirect("ai"), "/settings?tab=usage")
  assert.equal(legacySettingsRedirect("system"), "/settings?tab=info")
  assert.equal(legacySettingsRedirect("accounts"), "/settings/profile")
  assert.equal(legacySettingsRedirect("info"), null)
  assert.equal(legacySettingsRedirect(null), null)
  assert.equal(legacySettingsRedirect("constructor"), null)
})

test("수집 안내 링크는 개인정보 처리방침의 사용 기록 자리를 가리킨다", () => {
  assert.equal(UI_METRICS_NOTICE_HREF, "/privacy#ui-metrics")
})
