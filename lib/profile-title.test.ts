/** 프로필 카드 직급 · 소셜 아이콘. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"

import { profileTitle, socialProviders } from "./profile-title"

test("직급은 인력 표의 직급, 비었으면 겸직 직함, 둘 다 없으면 비운다", () => {
  assert.equal(profileTitle({ position: "과장", haddRole: null }), "과장")
  assert.equal(profileTitle({ position: "상무", haddRole: "CAO" }), "상무")
  assert.equal(profileTitle({ position: null, haddRole: "CAO" }), "CAO")
  assert.equal(profileTitle({ position: "  ", haddRole: " " }), null)
  assert.equal(profileTitle(null), null)
  assert.equal(profileTitle(undefined), null)
})

test("소셜은 연결된 것만 · 정해진 순서 · 모르는 제공자는 뺀다", () => {
  assert.deepEqual(socialProviders(["kakao", "google"]), ["google", "kakao"])
  assert.deepEqual(socialProviders(["kakao", "kakao", "naver"]), ["kakao"])
  assert.deepEqual(socialProviders([]), [])
})
