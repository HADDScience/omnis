import { test, expect } from "@playwright/test"
import { login } from "./_setup"
import { openSearch } from "./_actions"

test.describe("⌘K command palette", { tag: "@search" }, () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "팀장")
  })

  // 지키는 것: PC 에서 어느 화면에서든 ⌘K / Ctrl+K 로 검색을 연다
  test("키보드 단축키(⌘K / Ctrl+K)로 팔레트가 열린다", async ({ page }) => {
    await openSearch(page)
  })

  // 지키는 것: 검색 창에서 새 카드 · 새 업무를 바로 만들 수 있다
  test("팔레트는 최소 두 개의 quick-action(새 카드·새 업무)을 제공한다", async ({ page }) => {
    await openSearch(page)
    await expect(page.getByText("새 HADD 카드 만들기")).toBeVisible()
    await expect(page.getByText("새 업무 생성")).toBeVisible()
  })

  // 지키는 것: Esc 로 검색을 닫는다
  test("Esc 입력 시 팔레트가 닫힌다", async ({ page }) => {
    const input = await openSearch(page)
    await page.keyboard.press("Escape")
    await expect(input).not.toBeVisible({ timeout: 3_000 })
  })

  // 지키는 것: 단축키가 없는 폰에서도 검색을 열 길이 있다
  test("폰에서도 검색을 연다", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openSearch(page)
  })
})
