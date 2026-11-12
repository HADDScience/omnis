import { test } from "node:test"
import assert from "node:assert/strict"
import { feedbackRequest } from "./feedback"

test("종류 + 첫 줄로 제목, 본문은 다듬어 그대로", () => {
  assert.deepEqual(feedbackRequest("bug", "  사진이 안 열려요\n폰에서 눌렀더니 흰 화면  "), {
    title: "[불편 · 오류] 사진이 안 열려요",
    detail: "사진이 안 열려요\n폰에서 눌렀더니 흰 화면",
  })
  const long = "가".repeat(80)
  const r = feedbackRequest("idea", long)
  assert.ok("title" in r && r.title === `[의견 · 제안] ${"가".repeat(49)}…`)
})

test("모르는 종류 · 빈 내용은 거절", () => {
  assert.deepEqual(feedbackRequest("spam", "x"), { problem: "종류를 고르세요" })
  assert.deepEqual(feedbackRequest("question", "   "), { problem: "내용을 적어 주세요" })
  assert.deepEqual(feedbackRequest("question", 3), { problem: "내용을 적어 주세요" })
})
