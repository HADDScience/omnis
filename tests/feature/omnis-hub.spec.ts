import { test, expect } from "@playwright/test"
import { login } from "./_setup"

test.describe("HADD DB (Omnis 지식 허브)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "팀장")
  })

  test("HADD DB 메뉴 클릭 → /omnis 진입", async ({ page }) => {
    await page.getByRole("link", { name: "HADD DB" }).click()
    await expect(page).toHaveURL(/\/omnis$/)
    await expect(page.getByRole("heading", { name: /회사의 모든 지식/ })).toBeVisible()
  })

  test("3개 카테고리 칩(기업정보·인력현황·지식재산권)이 보인다", async ({ page }) => {
    await page.goto("/omnis")
    for (const category of ["기업정보", "인력현황", "지식재산권"]) {
      await expect(page.getByText(new RegExp(`${category}\\s*·`))).toBeVisible()
    }
  })

  test("API에서 카테고리 조회 시 200 + 3건 이상 반환", async ({ page }) => {
    const res = await page.evaluate(async () => {
      const r = await fetch("/api/categories")
      return { ok: r.ok, count: ((await r.json()) as unknown[]).length }
    })
    expect(res.ok).toBe(true)
    expect(res.count).toBeGreaterThanOrEqual(3)
  })
})
