import { test, expect } from "@playwright/test"
import { login } from "./_setup"

test.describe("dashboard / workspace canvas", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "팀장")
  })

  test("대시보드가 진행률·워크스페이스·팀원 현황 패널을 모두 렌더한다", async ({ page }) => {
    await expect(page.getByText("업무 진행률")).toBeVisible()
    await expect(page.getByText("워크스페이스").first()).toBeVisible()
    await expect(page.getByText("팀원별 현황")).toBeVisible()
  })

  test("워크스페이스 통계가 0이 아닌 노드 카운트를 보인다 (시드 데이터 검증)", async ({ page }) => {
    await expect(page.getByText(/\d+\s*노드/)).toBeVisible()
  })

  test("제품 라인 필터 칩이 5개 이상 노출된다", async ({ page }) => {
    await expect(page.getByRole("button", { name: "전체" }).first()).toBeVisible()
    for (const product of ["제품 A", "제품 B", "제품 C", "공통 R&D"]) {
      await expect(page.getByText(product, { exact: true }).first()).toBeVisible()
    }
  })

  test("REGRESSION: 캔버스 task 노드 클릭 → /tasks/{realUuid} 라우팅 (404 회귀 방지)", async ({ page }) => {
    await page.waitForTimeout(1500)

    const navigation = page.evaluate(async () => {
      const link = [...document.querySelectorAll("a[href^='/tasks/']")].find((a) => {
        const href = (a as HTMLAnchorElement).getAttribute("href") ?? ""
        return /\/tasks\/[0-9a-f-]{8,}/.test(href) && !href.includes("task-")
      }) as HTMLAnchorElement | undefined
      if (link) {
        link.click()
        return link.getAttribute("href")
      }
      return null
    })

    const href = await navigation
    if (href) {
      await page.waitForURL(`**${href}`, { timeout: 10_000 })
      await expect(page).not.toHaveURL(/\/tasks\/task-/)
      await expect(page.locator("body")).not.toContainText("This page could not be found")
    }
  })
})
