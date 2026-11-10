/**
 * iPad · iPhone 뷰포트: 뱃지가 화면 위로 잘리지 않고, 셸이 화면을 채우고, 입력창이 키보드 바로 위에 붙는다. PC 는 그대로다.
 *
 * 시험 브라우저(Chromium)에는 화면 키보드가 없어 visualViewport 를 모의한다.
 * 셸 높이가 짧아지는 것은 iOS Safari 에서만 나므로 scripts/verify-ios-viewport.mjs 가 시뮬레이터에서 잰다.
 */
import { expect, test, type Page } from "@playwright/test"
import { quickLogin } from "./_setup"

const COMPANY = "/chat/default-room"
const PILL = "[data-composer-pill]"
const textarea = (page: Page) => page.locator(`${PILL} textarea`).first()
const hydrated = (page: Page) =>
  expect.poll(() => textarea(page).evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))), { timeout: 30_000 }).toBe(true)
const docked = (page: Page) => page.evaluate(() => document.documentElement.hasAttribute("data-keyboard-docked"))
const bottomOf = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => el.getBoundingClientRect().bottom)
const shellBottom = (page: Page) =>
  page.locator("[data-main-scroll]").evaluate((el) => el.parentElement!.parentElement!.getBoundingClientRect().bottom)

/** 데모 배너가 있으면 배율 좌표 때문에 3px 남짓 어긋난다(이 PR 전부터). 고치려는 틈은 수십 px 이다 */
async function expectShellFills(page: Page, height: number) {
  await expect.poll(async () => Math.abs((await shellBottom(page)) - height)).toBeLessThanOrEqual(5)
}

async function mockViewport(page: Page) {
  await page.addInitScript(() => {
    const fake = new EventTarget() as EventTarget & Record<string, unknown>
    let height: number | null = null
    Object.defineProperties(fake, {
      height: { get: () => height ?? window.innerHeight },
      width: { get: () => window.innerWidth },
      scale: { value: 1 },
      offsetTop: { value: 0 },
      offsetLeft: { value: 0 },
    })
    Object.defineProperty(window, "visualViewport", { value: fake, configurable: true })
    ;(window as unknown as { __keyboard: (h: number | null) => void }).__keyboard = (h) => {
      height = h
      fake.dispatchEvent(new Event("resize"))
    }
  })
}
const keyboard = (page: Page, top: number | null) =>
  page.evaluate((h) => (window as unknown as { __keyboard: (h: number | null) => void }).__keyboard(h), top)

/** 안 읽은 알림 12건 — 두 자리 뱃지까지 본다 */
async function unreadNotifications(page: Page) {
  await page.route("**/api/notifications", async (route) => {
    if (route.request().method() !== "GET") return route.fallback()
    await route.fulfill({
      json: Array.from({ length: 12 }, (_, i) => ({
        id: `n${i}`, type: "info", title: `알림 ${i}`, content: null, entityId: null, read: false,
        createdAt: new Date().toISOString(), actionType: null, resolvedAt: null,
      })),
    })
  })
}

/** 뱃지가 화면 안에 다 들어오고, 그 자리에서 맨 위에 그려져 보인다 */
async function expectBadgeWhole(page: Page) {
  const badge = page.locator('nav[aria-label="주 메뉴"] button[aria-label="알림"] [data-slot="badge"]')
  await expect(badge).toHaveText("12", { timeout: 15_000 })
  const box = await badge.evaluate((el) => {
    const r = el.getBoundingClientRect()
    let clipped = false
    for (let p = el.parentElement; p; p = p.parentElement) {
      const style = getComputedStyle(p)
      if (style.overflowY === "visible" || p === document.documentElement || p === document.body) continue
      if (r.top < p.getBoundingClientRect().top) clipped = true
    }
    return { top: r.top, right: r.right, clipped, width: window.innerWidth }
  })
  expect(box.top, "화면 위로 나가지 않는다").toBeGreaterThanOrEqual(0)
  expect(box.right).toBeLessThanOrEqual(box.width)
  expect(box.clipped, "부모가 자르지 않는다").toBe(false)
}

async function dismissBanner(page: Page) {
  const close = page.getByRole("button", { name: /배너 닫기|닫기/ }).first()
  if (await close.isVisible().catch(() => false)) await close.click().catch(() => {})
}

async function open(page: Page, url = COMPANY) {
  await page.goto(url)
  await textarea(page).waitFor({ timeout: 30_000 })
  await hydrated(page)
}

for (const [name, viewport, keyboardTop] of [
  ["iPad 가로", { width: 1180, height: 820 }, 420],
  ["iPad 세로", { width: 820, height: 1180 }, 860],
] as const) {
  test.describe(name, () => {
    test.use({ viewport, hasTouch: true, isMobile: true })

    test("뱃지가 잘리지 않고 셸이 화면을 채운다", async ({ page }) => {
      await unreadNotifications(page)
      await quickLogin(page, "팀장")
      await open(page)
      await dismissBanner(page)
      await expectBadgeWhole(page)
      await expectShellFills(page, viewport.height)
      expect(viewport.height - (await bottomOf(page, PILL)), "입력창이 맨 아래까지 내려온다").toBeLessThanOrEqual(24)
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(viewport.height)
    })

    test("키보드가 열리면 입력창이 바로 위에 붙고, 닫으면 돌아온다", async ({ page }) => {
      await mockViewport(page)
      await quickLogin(page, "팀장")
      await open(page)
      const before = await bottomOf(page, PILL)
      await textarea(page).tap()
      await page.waitForTimeout(100)
      expect(await docked(page), "포커스만으로는 붙지 않는다 — 물리 키보드").toBe(false)

      await keyboard(page, keyboardTop)
      await expect.poll(() => docked(page)).toBe(true)
      const bottom = await bottomOf(page, PILL)
      expect(bottom, "키보드에 가려지지 않는다").toBeLessThanOrEqual(keyboardTop)
      expect(keyboardTop - bottom, "키보드와의 틈").toBeLessThanOrEqual(12)
      expect(await page.evaluate(() => scrollY)).toBe(0)

      await keyboard(page, null)
      await expect.poll(() => docked(page)).toBe(false)
      expect(await bottomOf(page, PILL)).toBe(before)
    })

    test("물리 키보드의 단축키 막대(55px)로는 붙지 않는다", async ({ page }) => {
      await mockViewport(page)
      await quickLogin(page, "팀장")
      await open(page)
      await textarea(page).tap()
      await keyboard(page, viewport.height - 55)
      await page.waitForTimeout(300)
      expect(await docked(page)).toBe(false)
    })

    test("입력창이 아닌 칸은 높이를 줄이지 않는다", async ({ page }) => {
      await mockViewport(page)
      await quickLogin(page, "팀장")
      await open(page)
      const search = page.getByPlaceholder("방 · 업무 · 마지막 글 검색")
      await search.tap()
      await keyboard(page, keyboardTop)
      await page.waitForTimeout(300)
      expect(await docked(page)).toBe(false)
      await expectShellFills(page, viewport.height)
    })
  })
}

test.describe("iPad 대화 패널", () => {
  test.use({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true })

  test("패널 입력창도 키보드 위로 올라온다", async ({ page }) => {
    await mockViewport(page)
    await quickLogin(page, "팀장")
    await page.goto("/tasks")
    await page.getByRole("button", { name: /^대화 패널 열기/ }).tap()
    const panel = page.locator('aside[aria-label="대화 패널"]')
    const box = panel.locator(`${PILL} textarea`).first()
    await box.waitFor({ timeout: 30_000 })
    await box.tap()
    await keyboard(page, 420)
    await expect.poll(() => docked(page)).toBe(true)
    await expect.poll(() => panel.evaluate((el) => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(420)
    expect(await panel.locator(PILL).first().evaluate((el) => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(420)
  })
})

test.describe("iPhone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test("셸이 화면을 채우고 nav 는 바닥에서 8px 위다", async ({ page }) => {
    await quickLogin(page, "팀장")
    await open(page)
    await expectShellFills(page, 844)
    // 대화방에는 하단 nav 가 없다 — 목록에서 본다
    await page.goto("/chat")
    const nav = page.locator('nav[aria-label="주 메뉴"]').last()
    await expect(nav).toBeVisible({ timeout: 30_000 })
    expect(844 - (await nav.evaluate((el) => el.getBoundingClientRect().bottom))).toBeLessThanOrEqual(8)
  })
})

test.describe("PC", () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test("배율 · 셸 높이 · 뱃지 · 패널이 그대로이고 키보드 판정에 들지 않는다", async ({ page }) => {
    await mockViewport(page)
    await unreadNotifications(page)
    await quickLogin(page, "팀장")
    await open(page)
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ui-zoom").trim())).toBe("1.1")
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--nav-offset-bottom").trim())).not.toBe("68px")
    await expectShellFills(page, 900)
    await expectBadgeWhole(page)

    await page.goto("/tasks")
    await page.getByRole("button", { name: /^대화 패널 열기/ }).click()
    const panel = page.locator('aside[aria-label="대화 패널"]')
    await expect(panel).toHaveAttribute("aria-hidden", "false")
    await expect.poll(() => panel.evaluate((el) => Math.round(innerHeight - el.getBoundingClientRect().bottom))).toBe(7)

    await open(page)
    await textarea(page).click()
    await keyboard(page, 400)
    await page.waitForTimeout(300)
    expect(await docked(page)).toBe(false)
  })
})
