import { test } from "node:test"
import assert from "node:assert/strict"
import { ONBOARDING_VERSION, effectiveOnboardingVersion, needsOnboarding, seenOnboardingVersion } from "./onboarding-version"

const at = "2026-10-30T00:00:00.000Z"

test("판 칸이 생기기 전에 마친 사람은 1판을 본 것으로 읽고, 지금 판(2)에서 다시 본다", () => {
  assert.equal(seenOnboardingVersion({ onboardingCompletedAt: at, onboardingVersion: null }), 1)
  assert.equal(needsOnboarding({ onboardingCompletedAt: at, onboardingVersion: null }), true)
})

test("한 번도 마치지 않은 사람은 본다", () => {
  assert.equal(seenOnboardingVersion({ onboardingCompletedAt: null, onboardingVersion: null }), 0)
  assert.equal(needsOnboarding({ onboardingCompletedAt: null, onboardingVersion: null }), true)
})

test("지금 판을 마치거나 건너뛰었으면 다시 띄우지 않는다 — 판을 올리면 다시 본다", () => {
  const done = { onboardingCompletedAt: at, onboardingVersion: ONBOARDING_VERSION }
  assert.equal(needsOnboarding(done), false)
  assert.equal(needsOnboarding(done, ONBOARDING_VERSION + 1), true)
  // 더 높은 판을 본 기록(되돌린 배포)은 낮은 판에서 다시 띄우지 않는다
  assert.equal(needsOnboarding({ onboardingCompletedAt: at, onboardingVersion: 99 }), false)
})

test("지금 판은 코드 상수와 관리자가 올린 값 중 큰 것 — 이상한 값은 무시한다", () => {
  assert.equal(effectiveOnboardingVersion(null), ONBOARDING_VERSION)
  assert.equal(effectiveOnboardingVersion({ version: ONBOARDING_VERSION + 3 }), ONBOARDING_VERSION + 3)
  // 코드 상수를 올려 배포하면 낮은 저장 값보다 앞선다
  assert.equal(effectiveOnboardingVersion({ version: 1 }, 5), 5)
  for (const bad of ["9", { version: "9" }, { version: 2.5 }, { version: Number.NaN }, [], 0]) {
    assert.equal(effectiveOnboardingVersion(bad), ONBOARDING_VERSION)
  }
})
