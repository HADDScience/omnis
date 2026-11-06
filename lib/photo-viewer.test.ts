import test from "node:test"
import assert from "node:assert/strict"
import { clampPan, clampScale, dragAxis, isViewerImage, positionLabel, releaseOutcome, viewerTime, withPhotoParam } from "@/lib/photo-viewer"

const base = { ms: 300, width: 400, count: 3, index: 1 }

test("옆으로 1/4 넘게 끌면 넘기고, 처음 · 끝에서는 더 가지 않는다", () => {
  assert.equal(releaseOutcome({ ...base, dx: -120, dy: 5 }), "next")
  assert.equal(releaseOutcome({ ...base, dx: 120, dy: 5 }), "prev")
  assert.equal(releaseOutcome({ ...base, dx: -60, dy: 5 }), "stay")
  assert.equal(releaseOutcome({ ...base, dx: -60, dy: 5, ms: 80 }), "next")
  assert.equal(releaseOutcome({ ...base, dx: -200, dy: 0, index: 2 }), "stay")
  assert.equal(releaseOutcome({ ...base, dx: 200, dy: 0, index: 0 }), "stay")
})

test("아래로 끌면 닫고, 위로 끌거나 조금 끌면 그대로다", () => {
  assert.equal(releaseOutcome({ ...base, dx: 10, dy: 130 }), "close")
  assert.equal(releaseOutcome({ ...base, dx: 0, dy: 50, ms: 60 }), "close")
  assert.equal(releaseOutcome({ ...base, dx: 0, dy: 60 }), "stay")
  assert.equal(releaseOutcome({ ...base, dx: 0, dy: -300 }), "stay")
})

test("끄는 방향은 10px 뒤에 정한다", () => {
  assert.equal(dragAxis(3, 4), null)
  assert.equal(dragAxis(20, 5), "x")
  assert.equal(dragAxis(5, -20), "y")
})

test("확대는 1~4배, 이동은 빈 곳이 보이지 않을 만큼만", () => {
  assert.equal(clampScale(0.3), 1)
  assert.equal(clampScale(9), 4)
  assert.deepEqual(clampPan(1, 50, 50, { w: 400, h: 800 }, { w: 400, h: 300 }), { x: 0, y: 0 })
  assert.deepEqual(clampPan(2, 500, -500, { w: 400, h: 800 }, { w: 400, h: 300 }), { x: 200, y: 0 })
})

test("표기 — 「N장 중 M번」 · 서울 시각", () => {
  assert.equal(positionLabel(0, 2), "2장 중 1번")
  assert.equal(viewerTime("2026-11-05T11:00:00Z"), "2026. 11. 5. 20:00")
})

test("미리보기로 그리는 사진만 — SVG · PDF 는 뷰어에 넣지 않는다", () => {
  assert.equal(isViewerImage({ mimeType: "image/jpeg", size: 1000 }), true)
  assert.equal(isViewerImage({ mimeType: "image/svg+xml", size: 1000 }), false)
  assert.equal(isViewerImage({ mimeType: "application/pdf", size: 1000 }), false)
})

test("주소의 ?photo= 를 넣고 뺀다 — 다른 값은 그대로", () => {
  assert.equal(withPhotoParam("https://x.test/chat/r?a=1", "f1"), "/chat/r?a=1&photo=f1")
  assert.equal(withPhotoParam("https://x.test/chat/r?a=1&photo=f1", null), "/chat/r?a=1")
})
