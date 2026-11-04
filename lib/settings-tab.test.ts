/** 마이 화면 탭 주소 값. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"

import { resolveSettingsTab, UI_METRICS_NOTICE_HREF } from "./settings-tab"

test("아는 탭은 그대로, 모르는 값 · 없는 값은 첫 탭", () => {
  assert.equal(resolveSettingsTab("system"), "system")
  assert.equal(resolveSettingsTab("ai"), "ai")
  assert.equal(resolveSettingsTab("nope"), "push")
  assert.equal(resolveSettingsTab("SYSTEM"), "push")
  assert.equal(resolveSettingsTab(""), "push")
  assert.equal(resolveSettingsTab(null), "push")
  assert.equal(resolveSettingsTab(undefined), "push")
})

test("수집 안내 링크는 시스템 탭의 안내 자리를 가리킨다", () => {
  assert.equal(UI_METRICS_NOTICE_HREF, "/settings?tab=system#ui-metrics-notice")
})
