/** 폰 채팅 목록의 큰 제목 줄 — 검색 · 새 대화 · 알림 아이콘, 칸 높이, 칩 줄과의 정리. PC 에는 없다 */
import { expect, test, type Page } from "@playwright/test"
import { quickLogin } from "./_setup"

const TITLE = "[data-chat-list-title]"
const LIST = 'nav[aria-label="채팅방"]'

async function openList(page: Page) {
  await quickLogin(page, "팀장")
  await page.goto("/chat")
  await page.locator(`aside a[href^="/chat/"]`).first().waitFor({ state: "attached", timeout: 30_000 })
  await expect
    .poll(() => page.locator("aside").first().evaluate((el) => Object.keys(el).some((k) => k.startsWith("__react"))), { timeout: 30_000 })
    .toBe(true)
}

for (const dark of [false, true]) {
  test.describe(`폰 ${dark ? "다크" : "라이트"}`, () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: dark ? "dark" : "light" })
    if (dark) test.beforeEach(async ({ page }) => page.addInitScript(() => localStorage.setItem("theme", "dark")))

    test("제목 24 · 아이콘 셋 44 · 칩까지 합쳐 위 칸이 110 을 넘지 않는다", async ({ page }) => {
      await openList(page)
      expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(dark)
      const heading = page.getByRole("heading", { level: 1, name: "채팅" })
      await expect(heading).toBeVisible()
      expect(await heading.evaluate((el) => getComputedStyle(el).fontSize)).toBe("24px")

      for (const name of ["채팅방 검색 열기", "새 대화", "알림"]) {
        const box = (await page.locator(TITLE).getByRole("button", { name }).boundingBox())!
        expect(box.width, name).toBeGreaterThanOrEqual(44)
        expect(box.height, name).toBeGreaterThanOrEqual(44)
      }

      // 제목 줄 위 끝 ~ 목록 위 끝. 데모 띠 높이는 뺀다
      const top = await page.locator(TITLE).evaluate((el) => el.getBoundingClientRect().top)
      const listTop = await page.locator(LIST).evaluate((el) => el.getBoundingClientRect().top)
      expect(listTop - top).toBeLessThanOrEqual(110)

      // 겹치던 것들이 정리됐다 — 칩 줄에 종이 없고 FAB 가 보이지 않는다
      await expect(page.locator("aside").getByRole("button", { name: "알림" })).toHaveCount(1)
      await expect(page.locator("[data-new-chat-fab]")).toBeHidden()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    })

    test("검색 아이콘은 숨은 검색칸을 꺼내 초점을 준다", async ({ page }) => {
      await openList(page)
      const input = page.getByRole("searchbox", { name: "채팅방 검색" })
      expect(await page.locator(LIST).evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
      await page.getByRole("button", { name: "채팅방 검색 열기" }).tap()
      await expect(input).toBeFocused()
      await expect.poll(() => page.locator(LIST).evaluate((el) => el.scrollTop)).toBe(0)
      const box = (await input.boundingBox())!
      const listTop = await page.locator(LIST).evaluate((el) => el.getBoundingClientRect().top)
      expect(box.y).toBeGreaterThanOrEqual(listTop)
    })

    test("새 대화 아이콘은 두 갈래 메뉴를 화면 안에 연다", async ({ page }) => {
      await openList(page)
      await page.locator("[data-new-chat-title]").tap()
      const item = page.getByRole("menuitem", { name: /사람과 대화/ })
      await expect(item).toBeVisible()
      const box = (await item.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(390)
    })

    test("알림 아이콘은 다른 아이콘과 같은 크기이고 목록을 화면 안에 연다", async ({ page }) => {
      await openList(page)
      const bell = page.locator(TITLE).getByRole("button", { name: "알림" })
      const sizes = await page.locator(`${TITLE} button svg`).evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width))
      expect(new Set(sizes).size).toBe(1)
      await bell.tap()
      const pop = page.getByRole("dialog").first()
      await expect(pop).toBeVisible()
      const box = (await pop.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(390)
    })

    test("방에 들어가면 제목 줄이 보이지 않는다", async ({ page }) => {
      await openList(page)
      const row = page.locator(`aside a[href="/chat/default-room"]`)
      await row.scrollIntoViewIfNeeded()
      await row.tap()
      await page.waitForURL("**/chat/default-room")
      await expect(page.locator(TITLE)).toBeHidden()
    })
  })
}

test.describe("PC", () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test("제목 줄이 없고 FAB · 칩 줄 · 검색칸은 그대로다", async ({ page }) => {
    await openList(page)
    await expect(page.locator(TITLE)).toBeHidden()
    await expect(page.locator("[data-new-chat-fab]")).toBeVisible()
    await expect(page.getByRole("searchbox", { name: "채팅방 검색" })).toBeVisible()
    await expect(page.getByRole("group", { name: "방 거르기" })).toBeVisible()
    await expect(page.getByRole("button", { name: "새 대화" })).toHaveCount(1)
  })
})
