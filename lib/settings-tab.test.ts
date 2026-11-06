/** 마이 화면 탭 주소 값. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"

import { legacySettingsRedirect, resolveSettingsTab, UI_METRICS_NOTICE_HREF } from "./settings-tab"

test("아는 탭은 그대로, 모르는 값 · 없는 값은 첫 탭", () => {
  assert.equal(resolveSettingsTab("info"), "info")
  assert.equal(resolveSettingsTab("usage"), "usage")
  assert.equal(resolveSettingsTab("nope"), "notify")
  assert.equal(resolveSettingsTab("INFO"), "notify")
  assert.equal(resolveSettingsTab(""), "notify")
  assert.equal(resolveSettingsTab(null), "notify")
  assert.equal(resolveSettingsTab(undefined), "notify")
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

test("수집 안내 링크는 앱 정보 탭의 안내 자리를 가리킨다", () => {
  assert.equal(UI_METRICS_NOTICE_HREF, "/settings?tab=info#ui-metrics-notice")
})
