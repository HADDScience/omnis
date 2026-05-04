import { test, expect } from "@playwright/test"
import { login } from "./_setup"

test.describe("⌘K command palette", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "팀장")
  })

  test("'검색 ⌘K' 버튼 클릭으로 명령 팔레트가 열린다", async ({ page }) => {
    await page.getByRole("button", { name: /검색.*⌘K/ }).click()
    await expect(page.getByPlaceholder(/HADD.*업무.*사람.*명령어/)).toBeVisible({ timeout: 5_000 })
  })

  test("팔레트는 최소 두 개의 quick-action(새 카드·새 업무)을 제공한다", async ({ page }) => {
    await page.getByRole("button", { name: /검색.*⌘K/ }).click()
    await expect(page.getByText("새 HADD 카드 만들기")).toBeVisible()
    await expect(page.getByText("새 업무 생성")).toBeVisible()
  })

  test("Esc 입력 시 팔레트가 닫힌다", async ({ page }) => {
    await page.getByRole("button", { name: /검색.*⌘K/ }).click()
    const input = page.getByPlaceholder(/HADD.*업무.*사람.*명령어/)
    await expect(input).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(input).not.toBeVisible({ timeout: 3_000 })
  })

  test("키보드 단축키(⌘K / Ctrl+K)로도 팔레트가 열린다", async ({ page }) => {
    const isMac = process.platform === "darwin"
    await page.keyboard.press(isMac ? "Meta+k" : "Control+k")
    await expect(page.getByPlaceholder(/HADD.*업무.*사람.*명령어/)).toBeVisible({ timeout: 5_000 })
  })
})
