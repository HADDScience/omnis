import { test, expect } from "@playwright/test"
import { login } from "./_setup"

test.describe("주간보고", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "팀장")
  })

  test("보고서 메뉴 클릭 → /reports 진입", async ({ page }) => {
    await page.getByRole("link", { name: "보고서" }).click()
    await expect(page).toHaveURL(/\/reports/)
  })

  test("보고서 페이지가 정상 응답한다 (404 아님)", async ({ page }) => {
    await page.goto("/reports")
    await expect(page.locator("body")).not.toContainText("This page could not be found")
  })
})
