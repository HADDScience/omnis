/** 첨부만 보낸 글의 글자. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"

import { attachAwareText, attachPlaceholderCount, visibleBody } from "./attachment-text"

test("옛 자리글 「[파일 N개 첨부]」 만 알아본다", () => {
  assert.equal(attachPlaceholderCount("[파일 4개 첨부]"), 4)
  assert.equal(attachPlaceholderCount(" [파일 12개 첨부] "), 12)
  assert.equal(attachPlaceholderCount("[파일 4개 첨부] 확인 부탁"), null)
  assert.equal(attachPlaceholderCount("파일 4개 첨부"), null)
})

test("화면 본문 — 자리글은 비우고 다른 글은 그대로", () => {
  assert.equal(visibleBody("[파일 4개 첨부]"), "")
  assert.equal(visibleBody("회의록 올립니다"), "회의록 올립니다")
  assert.equal(visibleBody("[파일 4개 첨부] 확인 부탁"), "[파일 4개 첨부] 확인 부탁")
})

test("인용 · 알림 — 첨부만 보낸 글은 「파일 N개」", () => {
  assert.equal(attachAwareText("", 3), "파일 3개")
  assert.equal(attachAwareText("[파일 4개 첨부]"), "파일 4개")
  assert.equal(attachAwareText("[파일 4개 첨부]", 2), "파일 2개")
  assert.equal(attachAwareText("글", 3), "글")
  assert.equal(attachAwareText("", 0), "")
})
