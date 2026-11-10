import { test } from "node:test"
import assert from "node:assert/strict"
import { featureKey, isFeatureStatus, parseFeatureInput } from "./feature-requests"
import { notificationHref } from "./schemas/notification"

test("같은 요청은 같은 키 — 공백 · 문장부호 · 대소문자 · 꼬리말을 걷는다", () => {
  assert.equal(featureKey("사진 일괄 다운로드 기능"), featureKey("사진 일괄다운로드"))
  assert.equal(featureKey("Excel 내보내기!"), featureKey("excel 내보내기 해주세요"))
  assert.notEqual(featureKey("사진 내려받기"), featureKey("파일 내려받기"))
})

test("입력 다듬기 — 제목 · 내용이 없으면 막는다, 제목은 80자에서 자른다", () => {
  assert.ok(parseFeatureInput({ title: "", detail: "x" }).problem)
  assert.ok(parseFeatureInput({ title: "x", detail: " " }).problem)
  assert.ok(parseFeatureInput({ title: "!!!", detail: "x" }).problem)
  const ok = parseFeatureInput({ title: "가".repeat(100), detail: " 필요 ", attempted: 3 })
  assert.equal(ok.problem, undefined)
  assert.equal(ok.title.length, 80)
  assert.equal(ok.detail, "필요")
  assert.equal(ok.attempted, "")
})

test("상태는 새로 · 검토 · 완료 셋", () => {
  for (const s of ["NEW", "REVIEW", "DONE"]) assert.ok(isFeatureStatus(s))
  assert.equal(isFeatureStatus("CLOSED"), false)
})

test("기능 요청 알림은 관리 화면으로 연다", () => {
  assert.equal(notificationHref("feature_request", "abc"), "/settings/feature-requests")
})
