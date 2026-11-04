/**
 * 마이 화면 탭을 주소로 — 수집 안내 알림의 「자세히」 가 시스템 탭의 안내를 바로 보여 주는지, 새로고침 · 뒤로 가기.
 * 알림은 자동화 브라우저에서 뜨지 않으므로(components/layout/ui-metrics.tsx) 여기서만 webdriver 표시를 끈다.
 */
import { expect, test, type Page } from "@playwright/test"
import { login } from "./_setup"

const notice = (page: Page) => page.locator("[data-ui-metrics-notice]")
const tab = (page: Page, name: string) => page.getByRole("tab", { name })

async function showNoticeToast(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false })
    // 앱 설치 · 기기 알림 권유가 대화창으로 알림을 가리지 않게
    localStorage.setItem("omnis:nudge-off:install", "1")
    localStorage.setItem("omnis:nudge-off:push", "1")
  })
}

for (const [label, device] of [
  ["PC", { viewport: { width: 1280, height: 720 } }],
  ["폰", { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }],
] as const) {
  test.describe(label, () => {
    test.use(device)

    test.skip(process.env.NEXT_PUBLIC_UI_METRICS !== "1", "사용 기록이 꺼진 빌드")

    test("알림의 「자세히」 → 시스템 탭 · 안내가 화면 안 · 새로고침 유지 · 뒤로 · 앞으로", async ({ page }) => {
      await showNoticeToast(page)
      await login(page, "사원1")
      const start = new URL(page.url()).pathname

      await page.getByRole("button", { name: "자세히" }).click()
      await page.waitForURL("**/settings?tab=system#ui-metrics-notice")
      await expect(tab(page, "시스템")).toHaveAttribute("aria-selected", "true")
      await expect(notice(page)).toBeVisible()
      await expect(notice(page)).toBeInViewport()
      await expect(notice(page)).toContainText("모으는 것")

      await page.reload()
      await expect(tab(page, "시스템")).toHaveAttribute("aria-selected", "true")
      await expect(notice(page)).toBeInViewport()

      await page.goBack()
      await expect.poll(() => new URL(page.url()).pathname).toBe(start)
      await page.goForward()
      await expect(tab(page, "시스템")).toHaveAttribute("aria-selected", "true")
      await expect(notice(page)).toBeInViewport()
    })

    test("이미 마이 화면에 있을 때 누른 「자세히」 도 탭을 바꾼다", async ({ page }) => {
      await showNoticeToast(page)
      await login(page, "사원2")
      await page.getByRole("button", { name: "자세히" }).waitFor()
      await page.goto("/settings")
      await page.evaluate(() => localStorage.removeItem("omnis:ui-metrics:notice:v1"))
      await page.reload()
      await expect(tab(page, "기기 알림")).toHaveAttribute("aria-selected", "true")
      await page.getByRole("button", { name: "자세히" }).click()
      await expect(tab(page, "시스템")).toHaveAttribute("aria-selected", "true")
      await expect(notice(page)).toBeInViewport()
    })
  })
}

test.describe("주소와 탭", () => {
  test("주소 값대로 열리고, 모르는 값은 첫 탭이다", async ({ page }) => {
    await login(page, "사원1")
    await page.goto("/settings?tab=ai")
    await expect(tab(page, "AI 사용량")).toHaveAttribute("aria-selected", "true")
    await page.goto("/settings?tab=nope")
    await expect(tab(page, "기기 알림")).toHaveAttribute("aria-selected", "true")
    await page.goto("/settings")
    await expect(tab(page, "기기 알림")).toHaveAttribute("aria-selected", "true")
  })

  test("탭을 누르면 주소가 바뀌어 새로고침해도 남고, 뒤로 가기는 탭이 아니라 앞 화면으로 간다", async ({ page }) => {
    await login(page, "사원1")
    await page.goto("/tasks")
    await page.goto("/settings")
    await tab(page, "연결된 계정").click()
    await expect(page).toHaveURL(/\/settings\?tab=accounts$/)
    await tab(page, "시스템").click()
    await expect(page).toHaveURL(/\/settings\?tab=system$/)
    await expect(tab(page, "시스템")).toHaveAttribute("aria-selected", "true")
    await page.reload()
    await expect(tab(page, "시스템")).toHaveAttribute("aria-selected", "true")
    await page.goBack()
    await expect(page).toHaveURL(/\/tasks$/)
  })
})
