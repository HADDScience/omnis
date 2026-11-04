/** 목록에 「새 대화」 줄을 두지 않는다 — 시작은 목록 칸 오른쪽 아래 FAB 로 한다 */
import { expect, test, type Page } from "@playwright/test"
import { quickLogin } from "./_setup"

const LIST = 'aside[aria-label="채팅방 목록"]'
const fab = (page: Page) => page.locator("[data-new-chat-fab]")

async function openList(page: Page) {
  await quickLogin(page, "팀장")
  await page.goto("/chat")
  await fab(page).waitFor({ timeout: 30_000 })
  // 방 줄이 그려진 뒤에 본다
  await expect(page.locator(`${LIST} a[href^="/chat/"]`).first()).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => fab(page).evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))), { timeout: 30_000 }).toBe(true)
}

async function expectStartPaths(page: Page) {
  await expect(page.locator(`${LIST} a[href="/chat/new"]`)).toHaveCount(0)
  await fab(page).click()
  await page.getByRole("menuitem", { name: /옴니스와 대화/ }).click()
  await page.waitForURL("**/chat/new")
  await expect(page.getByRole("textbox", { name: "옴니스에게 보낼 글" }).first()).toBeVisible({ timeout: 30_000 })

  await page.goto("/chat")
  await fab(page).waitFor({ timeout: 30_000 })
  await expect.poll(() => fab(page).evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))), { timeout: 30_000 }).toBe(true)
  await fab(page).click()
  await page.getByRole("menuitem", { name: /사람과 대화/ }).click()
  await page.waitForURL("**/chat/new/people")
}

test("PC — 목록에 줄이 없고, /chat 가운데 칸은 옴니스 새 대화이며, FAB 두 갈래로 시작한다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openList(page)
  await expect(page.getByRole("textbox", { name: "옴니스에게 보낼 글" }).first()).toBeVisible({ timeout: 30_000 })
  await expectStartPaths(page)
})

test.describe("폰", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test("목록만 보이고 줄이 없으며, FAB 두 갈래로 시작한다", async ({ page }) => {
    await openList(page)
    await expect(page.getByRole("textbox", { name: "옴니스에게 보낼 글" })).toBeHidden()
    await expectStartPaths(page)
  })
})
