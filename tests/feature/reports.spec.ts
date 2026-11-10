import { test, expect } from "@playwright/test"
import { login } from "./_setup"

test.describe("주간보고", { tag: "@reports" }, () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "팀장")
  })

  // 보고서는 nav 에서 뺐다(2026-10-28, 탭 다섯 개로 줄임). 주소와 MCP 주간보고는 그대로다
  // 지키는 것: nav 에서 뺀 주간보고 화면도 주소로는 계속 열린다(MCP 주간보고가 쓴다)
  test("보고서 페이지가 정상 응답한다 (404 아님)", async ({ page }) => {
    await page.goto("/reports")
    await expect(page.locator("body")).not.toContainText(
      "This page could not be found"
    )
  })
})
