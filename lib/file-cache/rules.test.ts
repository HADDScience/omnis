/** 파일 카드 받기 규칙. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"

import { openWay, planEviction, progressLabel, progressRatio } from "./rules"

const MB = 1024 * 1024
const e = (id: string, size: number, at: number) => ({ id, size: size * MB, at })

test("한도 안이면 아무것도 지우지 않는다", () => {
  assert.deepEqual(planEviction([e("a", 100, 1), e("b", 100, 2)], { id: "c", size: 50 * MB }, 300 * MB), [])
})

test("넘치면 오래 안 연 것부터 필요한 만큼만 지운다", () => {
  const entries = [e("new", 100, 30), e("old", 100, 10), e("mid", 100, 20)]
  assert.deepEqual(planEviction(entries, { id: "x", size: 150 * MB }, 300 * MB), ["old", "mid"])
  assert.deepEqual(planEviction(entries, { id: "x", size: 50 * MB }, 300 * MB), ["old"])
})

test("한도보다 큰 파일은 넣지 않는다(null) — 기기에 두지 않고 이 탭에서만 연다", () => {
  assert.equal(planEviction([], { id: "big", size: 301 * MB }, 300 * MB), null)
})

test("같은 파일을 다시 넣으면 자기 몫은 셈에서 뺀다", () => {
  assert.deepEqual(planEviction([e("a", 200, 1), e("b", 100, 2)], { id: "a", size: 200 * MB }, 300 * MB), [])
})

test("진행률 — 전체를 모르면 0, 넘치면 1", () => {
  assert.equal(progressRatio(5, 0), 0)
  assert.equal(progressRatio(15, 10), 1)
  assert.equal(progressLabel(1.9 * MB, 5.1 * MB), "37% · 1.9MB / 5.1MB")
  assert.equal(progressLabel(512 * 1024, 0), "512KB 받는 중")
})

test("열기 — 폰은 공유 시트, PC 는 안전한 형식만 새 탭 · 나머지는 저장", () => {
  assert.equal(openWay({ touch: true, canShareFile: true, inlineType: "application/pdf" }), "share")
  assert.equal(openWay({ touch: true, canShareFile: false, inlineType: "application/pdf" }), "tab")
  assert.equal(openWay({ touch: false, canShareFile: true, inlineType: "application/pdf" }), "tab")
  // zip · hwp, 그리고 HTML · SVG(safeInlineType 이 null) — 새 탭으로 열면 우리 주소에서 스크립트가 돈다
  assert.equal(openWay({ touch: false, canShareFile: false, inlineType: null }), "save")
})
