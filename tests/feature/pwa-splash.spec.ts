import { test, expect } from "@playwright/test"
import { login } from "./_setup"

// 홈 화면 앱을 켤 때의 첫 화면(2026-11-12 「검은 화면만 나온다」) — iOS 시작 이미지 · 매니페스트 · 셸 앞의 스플래시
test.describe("PWA 시작 화면", { tag: "@pwa" }, () => {
  // 지키는 것: iOS 가 기기 크기 · 라이트/다크에 맞는 시작 이미지를 찾는다(맞는 것이 없으면 빈 화면)
  test("첫 HTML 에 기기별 시작 이미지 링크가 있고, 그 그림이 정확한 크기로 나온다", async ({ page, request }) => {
    await page.goto("/login")
    const links = page.locator('link[rel="apple-touch-startup-image"]')
    expect(await links.count()).toBeGreaterThanOrEqual(40)
    const iphone15 = page.locator(
      'link[rel="apple-touch-startup-image"][media*="device-width: 393px"][media*="prefers-color-scheme: dark"]'
    )
    await expect(iphone15).toHaveCount(1)
    const href = await iphone15.getAttribute("href")
    expect(href).toMatch(/\/splash\/1179x2556-dark\.png$/)

    const res = await request.get(href!)
    expect(res.status()).toBe(200)
    expect(res.headers()["content-type"]).toBe("image/png")
    const png = await res.body()
    // PNG IHDR — 폭 · 높이(빅엔디언)
    expect(png.readUInt32BE(16)).toBe(1179)
    expect(png.readUInt32BE(20)).toBe(2556)

    expect((await request.get("/splash/123x456-light.png")).status()).toBe(404)
  })

  // 지키는 것: 아이콘은 곧장 /chat 으로 열고(왕복 하나 줄임), 이미 설치한 앱은 같은 앱으로 남는다(id)
  test("매니페스트 — id 는 그대로, start_url 은 /chat, 시작 화면 바탕은 흰색", async ({ request }) => {
    const manifest = await (await request.get("/manifest.webmanifest")).json()
    expect(manifest.id).toBe("/")
    expect(manifest.start_url).toBe("/chat")
    expect(manifest.background_color).toBe("#ffffff")
    expect(manifest.icons.some((i: { sizes: string }) => i.sizes === "512x512")).toBe(true)
  })

  // 지키는 것: 셸이 세션을 읽는 동안 스플래시가 먼저 나간다 — 첫 HTML 조각에 실려 있다
  test("로그인한 사람의 /chat 응답은 스플래시가 셸보다 먼저 온다", async ({ page }) => {
    await login(page, "팀장")
    const html = await page.evaluate(async () => (await fetch("/chat")).text())
    const splash = html.indexOf('id="omnis-splash"')
    const shell = html.indexOf("data-messenger")
    expect(splash).toBeGreaterThan(-1)
    expect(shell).toBeGreaterThan(splash)
    // 셸이 그려지면 스플래시는 사라진다
    await page.goto("/chat")
    await expect(page.locator("[data-messenger]")).toBeVisible()
    await expect(page.locator("#omnis-splash")).toHaveCount(0)
  })

  // 지키는 것: 셸을 흘려보내도 로그인하지 않은 사람은 로그인 화면으로 간다
  test("로그인하지 않으면 /chat 이 로그인 화면으로 보낸다", async ({ page }) => {
    await page.goto("/chat")
    await expect(page).toHaveURL(/\/login$/)
  })
})
