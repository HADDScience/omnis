/**
 * CRM 탭 전환 — 누르는 즉시 탭 표시 · 주소가 바뀌고 스켈레톤이 선다(2026-11-25 3차).
 *
 * 사용자 지적: 문의 · 샘플요청 같은 탭을 누르면 화면이 그냥 멈춰 있다.
 * 서버 응답을 일부러 늦춰(2.5초) 「응답 전에 이미 바뀌었는가」 를 본다. 늦추지 않으면 빠른 기계에서 시험이 아무것도 못 본다.
 */
import { expect, test } from "@playwright/test"
import { quickLogin } from "./_setup"

test.describe("CRM 탭 전환 @crm", () => {
  test.slow()

  test("누르면 응답 전에 탭 · 주소 · 스켈레톤이 바뀌고, 오면 채워진다. 뒤로 가기는 원래 탭", async ({ page }) => {
    await quickLogin(page, "팀장")
    await page.goto("/crm/quotes")
    const nav = page.getByRole("navigation", { name: "CRM" }).first()
    await expect(nav.locator('[data-crm-tab="quotes"]')).toHaveAttribute("aria-current", "page", { timeout: 30_000 })

    // 샘플요청 화면의 서버 응답(RSC · 미리 받기 포함)을 늦춘다
    let delayed = 0
    await page.route(/\/crm\/samples(\?|$)/, async (route) => {
      delayed++
      await new Promise((r) => setTimeout(r, 2_500))
      await route.continue()
    })

    const t0 = Date.now()
    await nav.locator('[data-crm-tab="samples"]').click()
    // 응답(2.5초)이 오기 전에 — 주소 · 탭 · 스켈레톤
    await expect(page).toHaveURL(/\/crm\/samples$/, { timeout: 1_500 })
    await expect(page.locator("[data-crm-tab-skeleton]")).toBeVisible({ timeout: 1_500 })
    await expect(page.locator('[data-crm-tab-skeleton] [data-crm-tab="samples"]')).toHaveAttribute("aria-current", "page")
    expect(Date.now() - t0).toBeLessThan(2_400)

    // 응답이 오면 채워진다 — 스켈레톤이 걷히고 샘플요청 화면
    await expect(page.locator("[data-crm-tab-skeleton]")).toHaveCount(0, { timeout: 30_000 })
    await expect(page.getByRole("navigation", { name: "CRM" }).locator('[data-crm-tab="samples"]')).toHaveAttribute("aria-current", "page")
    await expect(page.locator("header").getByText("샘플요청").first()).toBeVisible()
    expect(delayed).toBeGreaterThan(0)

    // 뒤로 가기 — 견적으로 돌아온다(주소가 두 번 쌓이지 않았다)
    await page.unroute(/\/crm\/samples(\?|$)/)
    await page.goBack()
    await expect(page).toHaveURL(/\/crm\/quotes$/, { timeout: 15_000 })
    await expect(page.getByRole("navigation", { name: "CRM" }).locator('[data-crm-tab="quotes"]')).toHaveAttribute("aria-current", "page", { timeout: 15_000 })
  })

  test("⌘ · Ctrl 누르고 누르면 브라우저에 맡긴다(새 탭) — 지금 화면은 그대로", async ({ page, context }) => {
    await quickLogin(page, "팀장")
    await page.goto("/crm/quotes")
    const nav = page.getByRole("navigation", { name: "CRM" }).first()
    await expect(nav.locator('[data-crm-tab="quotes"]')).toHaveAttribute("aria-current", "page", { timeout: 30_000 })
    const popup = context.waitForEvent("page")
    await nav.locator('[data-crm-tab="orgs"]').click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] })
    const tab = await popup
    await tab.close()
    await expect(page).toHaveURL(/\/crm\/quotes$/)
    await expect(page.locator("[data-crm-tab-skeleton]")).toHaveCount(0)
  })
})
