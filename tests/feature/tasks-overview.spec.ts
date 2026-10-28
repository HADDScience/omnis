import { test, expect } from "@playwright/test"
import { login } from "./_setup"

test.describe("업무 탭 — 현황 띠 / 관계도", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "팀장")
  })

  test("현황 띠가 진행률·멈춤 칩·상세를 한 줄에 렌더한다", async ({ page }) => {
    await expect(page.getByLabel("진행률 기간")).toBeVisible()
    await expect(page.getByRole("link", { name: /^멈춤/ })).toBeVisible()
    await expect(page.getByRole("button", { name: "상세" })).toBeVisible()
  })

  test("「멈춤」 칩은 목록 필터다 — 다시 누르면 풀린다", async ({ page }) => {
    await page.getByRole("link", { name: /^멈춤/ }).click()
    await expect(page).toHaveURL(/\/tasks\?filter=stalled$/)
    await expect(page.getByRole("link", { name: "멈춰 있는 업무 필터 해제" })).toBeVisible()
    await page.getByRole("link", { name: /^멈춤/ }).click()
    await expect(page).toHaveURL(/\/tasks$/)
  })

  test("「상세」 시트가 멈춘 업무·팀원별 현황을 보여 준다", async ({ page }) => {
    await page.getByRole("button", { name: "상세" }).click()
    await expect(page.getByText("멈춰 있는 업무").first()).toBeVisible()
    await page.getByRole("tab", { name: "팀원별" }).click()
    await expect(page.getByText("팀원별 현황")).toBeVisible()
  })

  test("관계도 보기가 0이 아닌 노드를 그린다 (시드 데이터 검증)", async ({ page }) => {
    await page.getByRole("button", { name: "관계도", exact: true }).click()
    await expect(page.locator(".react-flow__node").first()).toBeVisible()
    expect(await page.locator(".react-flow__node").count()).toBeGreaterThan(0)
  })

  test("제품 라인 필터 칩이 5개 이상 노출된다", async ({ page }) => {
    await page.getByRole("button", { name: "관계도", exact: true }).click()
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
    await page.getByRole("button", { name: "관계도", exact: true }).click()
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
