/**
 * 키보드 단축키 — 키 하나로는 동작하지 않고, 입력칸에서는 테마 · 패널이 동작하지 않으며, 설정에서 키를 바꾼다.
 * 판정 규칙의 단위 시험: lib/shortcuts.test.ts
 */
import { expect, test, type Page } from "@playwright/test"
import { quickLogin } from "./_setup"

const isDark = (page: Page) => page.evaluate(() => document.documentElement.classList.contains("dark"))
const panelInput = (page: Page) => page.getByPlaceholder("메시지 입력...  / 명령 · @ 사람 · # 업무")
const row = (page: Page, id: string) => page.locator(`[data-shortcut="${id}"]`)

async function ready(page: Page, url: string) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await quickLogin(page, "팀장")
  await page.goto(url)
  await page.locator("[data-main-scroll]").waitFor({ timeout: 30_000 })
  // 단축키를 듣기 시작한 뒤에 누른다
  await page.waitForLoadState("networkidle")
}

test("키 하나(d · c · ㅊ · f)로는 아무것도 바뀌지 않고, 조합키로만 동작한다", async ({ page }) => {
  await ready(page, "/tasks")
  const dark = await isDark(page)
  for (const key of ["d", "c", "f"]) await page.keyboard.press(key)
  // 한글 입력 상태의 C 자리 — 자판으로 칠 수 없어 키 이벤트를 직접 보낸다
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "ㅊ", code: "KeyC", bubbles: true })))
  await page.waitForTimeout(300)
  expect(await isDark(page)).toBe(dark)
  await expect(panelInput(page)).toHaveCount(0)

  await page.keyboard.press("Alt+Shift+KeyD")
  await expect.poll(() => isDark(page)).toBe(!dark)
  await page.keyboard.press("Alt+Shift+KeyC")
  await expect(panelInput(page)).toBeVisible()
  await page.keyboard.press("Alt+Shift+KeyD")
  await expect.poll(() => isDark(page)).toBe(dark)
})

test("입력칸 안에서는 테마 · 패널 단축키가 동작하지 않는다", async ({ page }) => {
  await ready(page, "/chat/new")
  const box = page.locator("[data-composer-pill] textarea").first()
  await box.waitFor({ timeout: 30_000 })
  await box.focus()
  const dark = await isDark(page)
  await page.keyboard.press("Alt+Shift+KeyD")
  await page.keyboard.press("Alt+Shift+KeyC")
  await page.waitForTimeout(300)
  expect(await isDark(page)).toBe(dark)
  await expect(panelInput(page)).toHaveCount(0)
})

test("검색 단축키는 입력칸 안에서도 받는다", async ({ page }) => {
  await ready(page, "/chat/new")
  const box = page.locator("[data-composer-pill] textarea").first()
  await box.waitFor({ timeout: 30_000 })
  await box.focus()
  await page.keyboard.press("ControlOrMeta+KeyK")
  await expect(page.getByRole("dialog")).toBeVisible()
})

test("설정에서 키를 바꾸면 저장되고, 겹치거나 조합키 없는 키는 거부하며, 기본값으로 되돌린다", async ({ page }) => {
  await ready(page, "/settings")
  const theme = row(page, "toggleTheme")
  await expect(theme.locator("kbd")).toBeVisible()
  await theme.getByRole("button").click()
  await expect(theme.locator("kbd")).toHaveText("키를 누르세요")

  await page.keyboard.press("KeyX")
  await expect(theme.getByRole("alert")).toContainText("함께 눌러")
  await page.keyboard.press("Shift+KeyX")
  await expect(theme.getByRole("alert")).toContainText("함께 눌러")
  await page.keyboard.press("Alt+Shift+KeyC")
  await expect(theme.getByRole("alert")).toContainText("이미 쓰는 키")
  await page.keyboard.press("ControlOrMeta+KeyD")
  await expect(theme.getByRole("alert")).toContainText("브라우저")

  // 거부되는 동안 아무것도 바뀌지 않았다
  const dark = await isDark(page)
  await expect(panelInput(page)).toHaveCount(0)

  await page.keyboard.press("Alt+Shift+KeyX")
  await expect(page.locator("[data-keyboard-shortcuts]").getByRole("status")).toHaveText("저장했습니다")

  // 새 키로 동작하고, 옛 키로는 동작하지 않는다
  await page.keyboard.press("Alt+Shift+KeyD")
  await page.waitForTimeout(200)
  expect(await isDark(page)).toBe(dark)
  await page.keyboard.press("Alt+Shift+KeyX")
  await expect.poll(() => isDark(page)).toBe(!dark)

  // 새로고침해도 남는다
  await page.reload()
  await page.waitForLoadState("networkidle")
  await page.keyboard.press("Alt+Shift+KeyX")
  await expect.poll(() => isDark(page)).toBe(dark)

  // 고르는 중 Esc 는 취소다
  await theme.getByRole("button").click()
  await page.keyboard.press("Escape")
  await expect(theme.locator("kbd")).not.toHaveText("키를 누르세요")

  await page.getByRole("button", { name: "기본값 복원" }).click()
  await expect(page.locator("[data-keyboard-shortcuts]").getByRole("status")).toHaveText("기본값으로 되돌렸습니다")
  await page.keyboard.press("Alt+Shift+KeyX")
  await page.waitForTimeout(200)
  expect(await isDark(page)).toBe(dark)
  await page.keyboard.press("Alt+Shift+KeyD")
  await expect.poll(() => isDark(page)).toBe(!dark)
  await page.reload()
  await page.waitForLoadState("networkidle")
  await page.keyboard.press("Alt+Shift+KeyX")
  await page.waitForTimeout(200)
  expect(await isDark(page)).toBe(!dark)
})

test("폰에는 단축키 설정이 보이지 않는다", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const page = await ctx.newPage()
  await quickLogin(page, "팀장")
  await page.goto("/settings")
  await page.getByRole("button", { name: /테마/ }).waitFor({ timeout: 30_000 })
  await expect(page.locator("[data-keyboard-shortcuts]")).toBeHidden()
  await ctx.close()
})
