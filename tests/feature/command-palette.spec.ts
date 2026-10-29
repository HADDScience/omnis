import { test, expect, type Page } from "@playwright/test"
import { login } from "./_setup"

// nav 의 「검색 ⌘K」 버튼은 탭을 넷으로 줄이며 뺐다(2026-10-28). PC 는 단축키, 폰은 마이 화면의 「검색」 행으로 연다.
async function openPalette(page: Page) {
  await page.keyboard.press("ControlOrMeta+k")
  await expect(page.getByPlaceholder(/HADD.*업무.*사람.*명령어/)).toBeVisible({ timeout: 5_000 })
}

test.describe("⌘K command palette", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "팀장")
  })

  test("키보드 단축키(⌘K / Ctrl+K)로 팔레트가 열린다", async ({ page }) => {
    await openPalette(page)
  })

  test("팔레트는 최소 두 개의 quick-action(새 카드·새 업무)을 제공한다", async ({ page }) => {
    await openPalette(page)
    await expect(page.getByText("새 HADD 카드 만들기")).toBeVisible()
    await expect(page.getByText("새 업무 생성")).toBeVisible()
  })

  test("Esc 입력 시 팔레트가 닫힌다", async ({ page }) => {
    await openPalette(page)
    await page.keyboard.press("Escape")
    await expect(page.getByPlaceholder(/HADD.*업무.*사람.*명령어/)).not.toBeVisible({ timeout: 3_000 })
  })

  test("폰에서는 마이 화면의 「검색」 행으로 연다", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/settings")
    await page.getByRole("button", { name: "검색", exact: true }).click()
    await expect(page.getByPlaceholder(/HADD.*업무.*사람.*명령어/)).toBeVisible({ timeout: 5_000 })
  })
})
