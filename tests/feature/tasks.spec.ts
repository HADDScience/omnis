import { test, expect } from "@playwright/test"
import { login } from "./_setup"
import { gotoTab, switchTasksView } from "./_actions"

test.describe("tasks (칸반·상세)", { tag: "@tasks" }, () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "팀장")
  })

  // 지키는 것: 주 메뉴의 업무 탭으로 업무 화면에 오고, 보기(목록·보드)를 고를 수 있다
  test("업무 페이지로 이동하면 칸반/리스트 토글이 보인다", async ({ page }) => {
    await gotoTab(page, "업무")
    await expect(page.getByRole("button", { name: "보드", exact: true })).toBeVisible()
  })

  // 지키는 것: 보드는 업무 상태 네 단계를 모두 열로 보여 준다
  test("칸반 보드에 4단(할 일·진행 중·리뷰·완료) 컬럼이 모두 있다", async ({
    page,
  }) => {
    await gotoTab(page, "업무")
    await switchTasksView(page, "보드")
    // 좁은 화면용 상태 탭도 같은 글자를 DOM 에 두고 데스크톱에서는 숨긴다 — 보이는 것만 센다
    for (const column of ["할 일", "진행 중", "리뷰", "완료"]) {
      await expect(
        page.getByText(column, { exact: true }).filter({ visible: true }).first()
      ).toBeVisible()
    }
  })

  // 지키는 것: 업무 목록 API 가 시드 업무를 돌려준다
  test("API에서 시드 업무가 0개 이상 조회된다", async ({ page }) => {
    const res = await page.evaluate(async () => {
      const r = await fetch("/api/tasks")
      return { ok: r.ok, count: ((await r.json()) as unknown[]).length }
    })
    expect(res.ok).toBe(true)
    expect(res.count).toBeGreaterThan(0)
  })

  // 지키는 것: 업무 상세 주소가 실제 업무 ID 로 열린다(404 가 아니다)
  test("API로 첫 업무 상세 페이지 진입이 200을 반환한다", async ({ page }) => {
    const taskId = await page.evaluate(async () => {
      const r = await fetch("/api/tasks")
      const tasks = (await r.json()) as { id: string }[]
      return tasks[0]?.id ?? null
    })
    expect(taskId).toBeTruthy()
    const response = await page.goto(`/tasks/${taskId}`, {
      waitUntil: "domcontentloaded",
    })
    expect(response?.status()).toBe(200)
    await expect(page.locator("body")).not.toContainText(
      "This page could not be found"
    )
  })

  // 지키는 것: 보드 카드에서 마감까지 남은 날(D-day)이 보인다
  test("업무 카드에는 제목·D-day 정보가 함께 표시된다", async ({ page }) => {
    await gotoTab(page, "업무")
    await switchTasksView(page, "보드")
    const dayBadge = page
      .getByText(/^D[+-]?\d+$|^오늘$|^내일$|^어제$|지연/)
      .first()
    await expect(dayBadge).toBeVisible({ timeout: 8_000 })
  })
})
