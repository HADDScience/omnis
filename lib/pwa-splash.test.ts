import { test } from "node:test"
import assert from "node:assert/strict"
import { SPLASH_SCREENS, findSplashImage, splashImages } from "./pwa-splash"

test("시작 이미지 — 폰은 세로, 태블릿은 가로 · 세로, 각각 라이트 · 다크", () => {
  const phones = SPLASH_SCREENS.filter((s) => !s.tablet).length
  const tablets = SPLASH_SCREENS.filter((s) => s.tablet).length
  assert.equal(splashImages().length, phones * 2 + tablets * 2 * 2)
})

test("파일 이름이 겹치지 않는다 — 한 이름이 두 기기를 가리키면 한쪽은 엉뚱한 크기를 받는다", () => {
  const files = splashImages().map((i) => i.file)
  assert.equal(new Set(files).size, files.length)
})

test("iPhone 15(393×852 @3) — 실제 픽셀 크기와 media 가 맞는다", () => {
  const light = findSplashImage("1179x2556-light.png")
  assert.ok(light)
  assert.equal(light.width, 1179)
  assert.equal(light.height, 2556)
  assert.equal(
    light.media,
    "(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait) and (prefers-color-scheme: light)"
  )
  assert.match(findSplashImage("1179x2556-dark.png")!.media, /prefers-color-scheme: dark/)
})

test("태블릿 가로 — 그림은 가로로 길고 device-width/height 는 세로 기준 그대로", () => {
  const land = findSplashImage("2732x2048-light.png")
  assert.ok(land)
  assert.match(land.media, /\(device-width: 1024px\) and \(device-height: 1366px\).*orientation: landscape/)
})

test("목록에 없는 이름은 찾지 않는다", () => {
  assert.equal(findSplashImage("../icon-512.png"), null)
  assert.equal(findSplashImage("1179x2556-sepia.png"), null)
})
