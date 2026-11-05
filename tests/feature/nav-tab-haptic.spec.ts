/**
 * 폰 하단 탭의 햅틱(lib/haptics.ts). 실제 진동은 CI 로 볼 수 없어 호출과 부작용만 본다.
 * 호출 기록은 소프트 이동 동안 남는다 — page.goto 를 하면 init script 가 다시 돌아 비워진다.
 */
import { expect, test, type Page } from "@playwright/test"
import { quickLogin } from "./_setup"

declare global {
  interface Window {
    __haptic: { vibrate: unknown[]; labels: { display: string; hidden: string | null; switch: boolean; tabIndex: number | undefined; focused: boolean }[]; clickTargets: string[] }
  }
}

const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }

/** vibrate 기록 · 라벨이 head 에 붙는 순간 기록 · window 까지 올라온 click 기록 */
const record = (vibrate: "record" | "missing" | "throws") =>
  ((mode: string) => {
    const log: Window["__haptic"] = { vibrate: [], labels: [], clickTargets: [] }
    window.__haptic = log
    if (mode === "missing") delete (Navigator.prototype as { vibrate?: unknown }).vibrate
    else
      Object.defineProperty(Navigator.prototype, "vibrate", {
        configurable: true,
        value(pattern: unknown) {
          log.vibrate.push(pattern)
          if (mode === "throws") throw new Error("vibrate 실패")
          return true
        },
      })
    const click = HTMLLabelElement.prototype.click
    HTMLLabelElement.prototype.click = function (this: HTMLLabelElement) {
      const input = this.querySelector("input")
      log.labels.push({
        display: this.style.display,
        hidden: this.getAttribute("aria-hidden"),
        switch: !!input?.hasAttribute("switch"),
        tabIndex: input?.tabIndex,
        focused: document.activeElement === input,
      })
      return click.call(this)
    }
    window.addEventListener("click", (e) => log.clickTargets.push((e.target as Element).tagName))
  }).toString()

const init = (page: Page, mode: "record" | "missing" | "throws") => page.addInitScript(`(${record(mode)})(${JSON.stringify(mode)})`)

const bottomNav = (page: Page) => page.locator('nav[aria-label="주 메뉴"]').last()
const topNav = (page: Page) => page.locator('nav[aria-label="주 메뉴"]').first()
const log = (page: Page) => page.evaluate(() => window.__haptic)

const settled = (page: Page, nav = bottomNav(page)) =>
  expect
    .poll(() => nav.locator("a").last().evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))), { timeout: 30_000 })
    .toBe(true)

async function firstTask(page: Page) {
  const data = (await (await page.request.get("/api/tasks")).json()) as { id: string }[] | { tasks: { id: string }[] }
  return (Array.isArray(data) ? data : data.tasks)[0].id
}

test.describe("폰", () => {
  test.use(PHONE)

  test("다른 탭을 누르면 이동하고 vibrate 를 10ms 한 번 부른다. 스위치는 만들지 않는다", async ({ page }) => {
    await init(page, "record")
    await quickLogin(page, "팀장")
    await page.goto("/calendar")
    await settled(page)
    await bottomNav(page).getByRole("link", { name: "업무" }).tap()
    await page.waitForURL("**/tasks", { timeout: 30_000 })
    await bottomNav(page).getByRole("link", { name: "채팅" }).tap()
    await page.waitForURL("**/chat", { timeout: 30_000 })
    const { vibrate, labels } = await log(page)
    expect(vibrate).toEqual([10, 10])
    expect(labels).toEqual([])
  })

  test("이미 켜진 탭을 다시 누르면 내지 않는다 — 대화방에는 하단 탭이 없다", async ({ page }) => {
    await init(page, "record")
    await quickLogin(page, "팀장")
    await page.goto("/calendar")
    await settled(page)
    await bottomNav(page).getByRole("link", { name: "캘린더" }).tap()
    await page.waitForTimeout(300)
    expect((await log(page)).vibrate).toEqual([])

    const task = await firstTask(page)
    await page.goto(`/chat/task/${task}`)
    await settled(page)
    await expect(bottomNav(page)).toBeHidden()
    await page.goto("/chat")
    await settled(page)
    await bottomNav(page).getByRole("link", { name: "채팅" }).tap()
    await page.waitForTimeout(300)
    expect((await log(page)).vibrate).toEqual([])
  })

  test("vibrate 가 없으면(iOS) 숨긴 스위치를 쓰고, 포커스 · 접근성 트리 · 가로 폭 · DOM · click 처리기에 남는 것이 없다", async ({ page }) => {
    await init(page, "missing")
    await quickLogin(page, "팀장")
    await page.goto("/calendar")
    await settled(page)
    const before = await page.evaluate(() => document.documentElement.scrollWidth)
    await bottomNav(page).getByRole("link", { name: "업무" }).tap()
    await page.waitForURL("**/tasks", { timeout: 30_000 })

    const { labels, clickTargets } = await log(page)
    expect(labels).toEqual([{ display: "none", hidden: "true", switch: true, tabIndex: -1, focused: false }])
    // 라벨 · 스위치의 click 은 window 까지 오지 않는다 — 탭의 진짜 클릭만 온다
    expect(clickTargets.filter((t) => t === "LABEL" || t === "INPUT")).toEqual([])
    expect(clickTargets.length).toBe(1)

    await expect(page.locator("input[switch]")).toHaveCount(0)
    await expect(page.locator('head label, label[aria-hidden="true"]')).toHaveCount(0)
    await expect(page.getByRole("switch", { includeHidden: true })).toHaveCount(0)
    const after = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, active: document.activeElement?.tagName }))
    expect(after.width).toBe(before)
    expect(after.active).not.toBe("INPUT")
  })

  test("vibrate 가 터져도 탭 이동은 된다", async ({ page }) => {
    await init(page, "throws")
    await quickLogin(page, "팀장")
    await page.goto("/calendar")
    await settled(page)
    await bottomNav(page).getByRole("link", { name: "업무" }).tap()
    await page.waitForURL("**/tasks", { timeout: 30_000 })
    expect((await log(page)).vibrate).toEqual([10])
  })

  test("라벨 클릭이 터져도 탭 이동은 되고 요소가 남지 않는다", async ({ page }) => {
    await init(page, "missing")
    await page.addInitScript(() => {
      HTMLLabelElement.prototype.click = () => {
        throw new Error("클릭 실패")
      }
    })
    await quickLogin(page, "팀장")
    await page.goto("/calendar")
    await settled(page)
    await bottomNav(page).getByRole("link", { name: "업무" }).tap()
    await page.waitForURL("**/tasks", { timeout: 30_000 })
    await expect(page.locator("input[switch]")).toHaveCount(0)
  })
})

test.describe("폰이 아니면 내지 않는다", () => {
  test.describe("PC", () => {
    test.use({ viewport: { width: 1440, height: 900 } })
    test("위쪽 탭", async ({ page }) => {
      await init(page, "record")
      await quickLogin(page, "팀장")
      await page.goto("/calendar")
      await settled(page, topNav(page))
      await topNav(page).getByRole("link", { name: "업무" }).click()
      await page.waitForURL("**/tasks", { timeout: 30_000 })
      expect((await log(page)).vibrate).toEqual([])
    })
  })

  test.describe("좁힌 PC 창 — 하단 탭이지만 터치가 아니다", () => {
    test.use({ viewport: { width: 700, height: 800 } })
    test("하단 탭", async ({ page }) => {
      await init(page, "record")
      await quickLogin(page, "팀장")
      await page.goto("/calendar")
      await settled(page)
      await bottomNav(page).getByRole("link", { name: "업무" }).click()
      await page.waitForURL("**/tasks", { timeout: 30_000 })
      const { vibrate, labels } = await log(page)
      expect(vibrate).toEqual([])
      expect(labels).toEqual([])
    })
  })

  test.describe("iPad 폭 터치 기기", () => {
    test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true })
    test("위쪽 탭", async ({ page }) => {
      await init(page, "missing")
      await quickLogin(page, "팀장")
      await page.goto("/calendar")
      await settled(page, topNav(page))
      await topNav(page).getByRole("link", { name: "업무" }).tap()
      await page.waitForURL("**/tasks", { timeout: 30_000 })
      expect((await log(page)).labels).toEqual([])
    })
  })
})
