/** md 미만에는 대화 단추와 오른쪽 패널이 없다. 패널로 가던 길은 채팅 탭으로 간다. PC 는 그대로다 */
import { expect, test, type Page } from "@playwright/test"
import { quickLogin } from "./_setup"

const dock = (page: Page) => page.getByRole("button", { name: /^대화 패널 열기/ })
const panel = (page: Page) => page.locator('aside[aria-label="대화 패널"]')

async function firstTask(page: Page) {
  const data = (await (await page.request.get("/api/tasks")).json()) as { id: string }[] | { tasks: { id: string }[] }
  return (Array.isArray(data) ? data : data.tasks)[0].id
}

/** 하이드레이션이 끝나야 단축키 · 효과가 돈다 — 알림 종 같은 것이 아니라 React 가 붙은 nav 로 본다 */
const settled = (page: Page) =>
  expect
    .poll(() => page.locator('nav[aria-label="주 메뉴"] a').last().evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))), { timeout: 30_000 })
    .toBe(true)

for (const [name, use] of [
  ["폰", { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }],
  ["좁은 PC 창", { viewport: { width: 700, height: 800 } }],
] as const) {
  test.describe(name, () => {
    test.use(use)

    test("어느 탭에도 단추가 없고, 저장된 「열림」 값이 있어도 패널이 열리지 않으며 폴링도 돌지 않는다", async ({ page }) => {
      await quickLogin(page, "팀장")
      await page.evaluate(() => localStorage.setItem("omnis:right-panel-open", "1"))
      let polls = 0
      page.on("request", (r) => {
        if (new URL(r.url()).pathname.endsWith("/api/chat/messages")) polls++
      })
      const task = await firstTask(page)
      for (const url of ["/calendar", "/tasks", `/tasks/${task}`, "/omnis"]) {
        await page.goto(url)
        await settled(page)
        await page.waitForTimeout(300)
        await expect(dock(page), url).toBeHidden()
        await expect(panel(page), url).toBeHidden()
        await expect(page.getByRole("button", { name: "패널 닫기" }), url).toHaveCount(0)
      }
      await page.waitForTimeout(4_000)
      expect(polls).toBe(0)
    })

    test("?taskId= 는 그 업무방으로 간다", async ({ page }) => {
      await quickLogin(page, "팀장")
      const task = await firstTask(page)
      await page.goto(`/calendar?taskId=${task}`)
      await page.waitForURL(`**/chat/task/${task}`, { timeout: 30_000 })
    })

    test("업무 상세에서 그 업무방으로 간다", async ({ page }) => {
      await quickLogin(page, "팀장")
      const task = await firstTask(page)
      await page.goto(`/tasks/${task}`)
      await settled(page)
      await page.locator("[data-task-room-link]").click()
      await page.waitForURL(`**/chat/task/${task}`, { timeout: 30_000 })
    })

    test("단축키는 채팅 탭으로 간다", async ({ page }) => {
      await quickLogin(page, "팀장")
      for (const key of ["Alt+Shift+KeyC", "ControlOrMeta+Shift+KeyF"]) {
        await page.goto("/calendar")
        await settled(page)
        await page.keyboard.press(key)
        await page.waitForURL("**/chat", { timeout: 30_000 })
        await expect(panel(page)).toBeHidden()
      }
    })
  })
}

test.describe("PC", () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test("단추 · 단축키 · ?taskId= · 저장 값은 그대로 패널을 연다", async ({ page }) => {
    await quickLogin(page, "팀장")
    await page.goto("/calendar")
    await settled(page)
    await expect(page.locator("[data-task-room-link]")).toHaveCount(0)
    await dock(page).click()
    await expect(panel(page)).toHaveAttribute("aria-hidden", "false")
    await page.evaluate(() => localStorage.setItem("omnis:right-panel-open", "0"))

    await page.goto("/calendar")
    await settled(page)
    await expect(panel(page)).toHaveAttribute("aria-hidden", "true")
    await page.keyboard.press("Alt+Shift+KeyC")
    await expect(panel(page)).toHaveAttribute("aria-hidden", "false")
    expect(new URL(page.url()).pathname).toBe("/calendar")
    await page.evaluate(() => localStorage.setItem("omnis:right-panel-open", "0"))

    const task = await firstTask(page)
    await page.goto(`/calendar?taskId=${task}`)
    await settled(page)
    await expect(panel(page)).toHaveAttribute("aria-hidden", "false")
    expect(new URL(page.url()).pathname).toBe("/calendar")

    await page.goto("/calendar")
    await settled(page)
    await expect(panel(page)).toHaveAttribute("aria-hidden", "false")
  })

  test("업무 상세에서 연 패널은 그 업무 스레드다", async ({ page }) => {
    await quickLogin(page, "팀장")
    const task = await firstTask(page)
    await page.evaluate(() => localStorage.setItem("omnis:right-panel-open", "0"))
    await page.goto(`/tasks/${task}`)
    await settled(page)
    await expect(page.locator("[data-task-room-link]")).toBeHidden()
    await dock(page).click()
    await expect(panel(page).getByRole("button", { name: /이 업무/ })).toBeVisible()
  })
})
