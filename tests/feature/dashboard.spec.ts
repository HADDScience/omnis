import { test, expect } from "@playwright/test"
import { login } from "./_setup"

test.describe("dashboard / workspace canvas", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "팀장")
  })

  test("대시보드가 진행률·워크스페이스·팀원 현황 패널을 모두 렌더한다", async ({
    page,
  }) => {
    await expect(page.getByText("업무 진행률")).toBeVisible()
    await expect(page.getByText("워크스페이스").first()).toBeVisible()
    await expect(page.getByText("팀원별 현황")).toBeVisible()
  })

  test("워크스페이스 통계가 0이 아닌 노드 카운트를 보인다 (시드 데이터 검증)", async ({
    page,
  }) => {
    await expect(page.locator(".react-flow__node").first()).toBeVisible()
    expect(await page.locator(".react-flow__node").count()).toBeGreaterThan(0)
  })

  test("제품 라인 필터 칩이 5개 이상 노출된다", async ({ page }) => {
    await expect(
      page.getByRole("button", { name: "전체" }).first()
    ).toBeVisible()
    for (const product of ["제품 A", "제품 B", "제품 C", "공통 R&D"]) {
      await expect(
        page.getByText(product, { exact: true }).first()
      ).toBeVisible()
    }
  })

  test("REGRESSION: 캔버스 업무 더블클릭 → 실제 UUID 상세 경로", async ({
    page,
  }) => {
    await page.getByText("클릭하여 인터랙션", { exact: true }).click()
    const node = page.locator('.react-flow__node[data-id^="task-"]').first()
    await expect(node).toBeVisible()
    const id = (await node.getAttribute("data-id"))!.replace(/^task-/, "")
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    // Select first so the inspector and node outline have settled before the gesture.
    await node.click()
    await expect(
      page.getByRole("button", { name: "상세 열기", exact: true })
    ).toBeVisible()
    await node.dblclick({ delay: 100 })
    await expect(page).toHaveURL(new RegExp(`/tasks/${id}$`))
    await expect(page.locator("body")).not.toContainText(
      "This page could not be found"
    )
  })
})
