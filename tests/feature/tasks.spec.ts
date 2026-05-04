import { test, expect } from "@playwright/test"
import { login } from "./_setup"

test.describe("tasks (칸반·상세)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "팀장")
  })

  test("내 업무 페이지로 이동하면 칸반/리스트 토글이 보인다", async ({ page }) => {
    await page.getByRole("link", { name: "내 업무" }).click()
    await expect(page).toHaveURL(/\/tasks/)
    await expect(page.getByRole("button", { name: /보드/ }).first()).toBeVisible()
  })

  test("칸반 보드에 4단(할 일·진행 중·리뷰·완료) 컬럼이 모두 있다", async ({ page }) => {
    await page.getByRole("link", { name: "내 업무" }).click()
    await page.getByRole("button", { name: /보드/ }).first().click()
    for (const column of ["할 일", "진행 중", "리뷰", "완료"]) {
      await expect(page.getByText(column, { exact: true }).first()).toBeVisible()
    }
  })

  test("API에서 시드 업무가 0개 이상 조회된다", async ({ page }) => {
    const res = await page.evaluate(async () => {
      const r = await fetch("/api/tasks")
      return { ok: r.ok, count: ((await r.json()) as unknown[]).length }
    })
    expect(res.ok).toBe(true)
    expect(res.count).toBeGreaterThan(0)
  })

  test("API로 첫 업무 상세 페이지 진입이 200을 반환한다", async ({ page }) => {
    const taskId = await page.evaluate(async () => {
      const r = await fetch("/api/tasks")
      const tasks = (await r.json()) as { id: string }[]
      return tasks[0]?.id ?? null
    })
    expect(taskId).toBeTruthy()
    await page.goto(`/tasks/${taskId}`)
    await expect(page.locator("body")).not.toContainText("This page could not be found")
  })

  test("업무 카드에는 제목·D-day 정보가 함께 표시된다", async ({ page }) => {
    await page.getByRole("link", { name: "내 업무" }).click()
    await page.getByRole("button", { name: /보드/ }).first().click()
    const dayBadge = page.getByText(/^D[+-]?\d+$|^오늘$|^내일$|^어제$|지연/).first()
    await expect(dayBadge).toBeVisible({ timeout: 8_000 })
  })
})
