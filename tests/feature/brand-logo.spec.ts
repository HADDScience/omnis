import { readFileSync } from "node:fs"
import path from "node:path"
import { test, expect, type Page } from "@playwright/test"
import { resolveBrand } from "../../lib/brand-static.mjs"
import { quickLogin } from "./_setup"

/**
 * 로고 전환(lib/brand.ts) — 서버를 빌드한 것과 같은 NEXT_PUBLIC_BRAND 를 이 시험에도 준다.
 * CI 는 값이 없어 v1(지금 로고)을 본다: 이 PR 이 들어가도 지금 로고 그대로인지.
 * 새 로고는 `NEXT_PUBLIC_BRAND=v2` 로 빌드한 서버에 같은 env 로 돌린다.
 */
const BRAND = resolveBrand(process.env.NEXT_PUBLIC_BRAND)
const V2 = BRAND === "v2"
const PUBLIC = path.join(process.cwd(), "public")

/** 고정 주소가 실제로 내주는 파일 — v1 은 public 의 원래 파일, v2 는 public/brand/v2 의 같은 이름 */
function servedFile(p: string) {
  return readFileSync(path.join(PUBLIC, V2 ? `brand/v2${p}` : p))
}

async function iconHrefs(page: Page, rel: string) {
  return page.locator(`head link[rel="${rel}"]`).evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""))
}

test.describe(`brand logo (${BRAND})`, () => {
  test("고정 주소(favicon · 알림 아이콘 · 옛 manifest 아이콘 · 타일 마크)가 그 판의 파일을 낸다", async ({ request }) => {
    for (const p of ["/favicon.ico", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/omnis-logo.png"]) {
      const res = await request.get(p)
      expect(res.status(), p).toBe(200)
      expect(Buffer.compare(await res.body(), servedFile(p)), p).toBe(0)
    }
  })

  test("manifest — 아이콘 · 테마 색이 그 판의 것이다", async ({ request }) => {
    const m = await (await request.get("/manifest.webmanifest")).json()
    const srcs = m.icons.map((i: { src: string }) => i.src)
    if (V2) {
      expect(srcs).toEqual(["/brand/v2/icon-192.png", "/brand/v2/icon-512.png", "/brand/v2/icon-maskable-512.png"])
      expect(m.theme_color).toBe("#044ABF")
    } else {
      expect(srcs).toEqual(["/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"])
      expect(m.theme_color).toBe("#1447e6")
    }
    expect(m.icons.find((i: { purpose: string }) => i.purpose === "maskable")).toBeTruthy()
    for (const src of srcs) expect((await request.get(src)).status(), src).toBe(200)
  })

  test("앱 화면 — 탭 아이콘 · 홈 화면 아이콘 링크가 그 판의 파일이고 실제로 열린다", async ({ page, request }) => {
    await quickLogin(page, "팀장")
    const icons = await iconHrefs(page, "icon")
    const apple = await iconHrefs(page, "apple-touch-icon")
    if (V2) {
      expect(icons).toEqual(["/brand/v2/favicon.ico", "/brand/v2/omnis-appicon.svg", "/brand/v2/icon.png"])
      expect(apple).toEqual(["/brand/v2/apple-icon.png"])
    } else {
      expect(icons).toEqual(["/brand/v1/icon.png"])
      expect(apple).toEqual(["/brand/v1/apple-icon.png"])
    }
    for (const href of [...icons, ...apple]) expect((await request.get(href)).status(), href).toBe(200)
    // 새 로고일 때만 <html data-brand="v2"> — 로고 타일 바탕을 바꾸는 표시
    if (V2) await expect(page.locator("html")).toHaveAttribute("data-brand", "v2")
    else await expect(page.locator("html")).not.toHaveAttribute("data-brand", /.+/)
  })

  test("로그인 화면은 어느 판이든 HADD 마크를 쓴다", async ({ page, request }) => {
    await page.goto("/login")
    const icons = await iconHrefs(page, "icon")
    expect(icons).toEqual(["/brand/hadd/icon.png"])
    const body = await (await request.get(icons[0])).body()
    expect(Buffer.compare(body, readFileSync(path.join(PUBLIC, "brand/hadd/icon.png")))).toBe(0)
    expect(await iconHrefs(page, "apple-touch-icon")).toEqual(V2 ? ["/brand/v2/apple-icon.png"] : ["/brand/v1/apple-icon.png"])
  })

  test("랜딩 머리말 로고 타일 — 그 판의 흰 마크와 바탕", async ({ page }) => {
    await page.goto("/")
    const img = page.locator(".header-omnis-mark img")
    await expect(img).toHaveAttribute("src", V2 ? "/brand/v2/omnis-logo.svg" : "/omnis-logo.png")
    await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    const bg = await page.locator(".header-omnis-mark").evaluate((el) => getComputedStyle(el).backgroundImage)
    // v1: #225af8 → #0835d5 그라데이션, v2: 단색 #044abf
    expect(bg).toContain(V2 ? "rgb(4, 74, 191)" : "rgb(34, 90, 248)")
  })
})
