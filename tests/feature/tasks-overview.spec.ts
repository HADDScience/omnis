import { test, expect } from "@playwright/test"
import { login } from "./_setup"
import {
  openTasksOverview,
  switchTasksView,
  toggleStalledTasks,
  visibleTaskCount,
} from "./_actions"

test.describe("업무 탭 — 현황 띠 / 관계도", { tag: "@tasks" }, () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "팀장")
  })

  // 지키는 것: 업무 화면 맨 위에서 진행률 · 멈춘 업무 수 · 상세 보기를 한눈에 본다
  test("현황 띠가 진행률·멈춤 칩·상세를 한 줄에 렌더한다", async ({ page }) => {
    await expect(page.getByLabel("진행률 기간")).toBeVisible()
    await expect(page.getByRole("link", { name: /^멈춤/ })).toBeVisible()
    await expect(page.getByRole("button", { name: "상세" })).toBeVisible()
  })

  // 지키는 것: 「멈춤」 칩은 멈춘 업무만 보는 필터이고, 다시 누르면 풀린다
  test("「멈춤」 칩은 목록 필터다 — 다시 누르면 풀린다", async ({ page }) => {
    await toggleStalledTasks(page)
    await expect(page).toHaveURL(/\/tasks\?filter=stalled$/)
    await expect(page.getByRole("link", { name: "멈춰 있는 업무 필터 해제" })).toBeVisible()
    await toggleStalledTasks(page)
    await expect(page).toHaveURL(/\/tasks$/)
  })

  // 지키는 것: 필터 칩은 서버에 다시 묻지 않고 그 자리에서 거른다 — 누른 뒤 화면이 멈췄다가
  // 한꺼번에 바뀌던 블로킹 내비게이션(2026-10-29)이 돌아오지 않는다
  test("필터 칩은 서버 재요청 없이 바로 거른다", async ({ page }) => {
    const all = await visibleTaskCount(page)
    const rsc: string[] = []
    // 보이는 링크를 미리 받는 요청(next-router-prefetch)은 운영 빌드에서 늘 생긴다 — 이 화면을 다시 그리러 가는 것만 센다
    page.on("request", (r) => {
      const h = r.headers()
      if (h["rsc"] && !h["next-router-prefetch"] && new URL(r.url()).pathname === "/tasks") rsc.push(r.url())
    })
    await toggleStalledTasks(page)
    await expect(page).toHaveURL(/\/tasks\?filter=stalled$/)
    await expect.poll(() => visibleTaskCount(page)).not.toBe(all)
    await toggleStalledTasks(page)
    await expect.poll(() => visibleTaskCount(page)).toBe(all)
    expect(rsc, "필터를 바꿀 때 서버 컴포넌트를 다시 받으면 안 된다").toEqual([])
  })

  // 지키는 것: 「상세」 에서 멈춘 업무와 팀원별 현황을 자세히 본다
  test("「상세」 시트가 멈춘 업무·팀원별 현황을 보여 준다", async ({ page }) => {
    await openTasksOverview(page)
    await expect(page.getByText("멈춰 있는 업무").first()).toBeVisible()
    await page.getByRole("tab", { name: "팀원별" }).click()
    await expect(page.getByText("팀원별 현황", { exact: true })).toBeVisible()
  })

  // 지키는 것: 관계도 보기가 업무를 노드로 그린다
  test("관계도 보기가 0이 아닌 노드를 그린다 (시드 데이터 검증)", async ({ page }) => {
    await switchTasksView(page, "관계도")
    await expect(page.locator(".react-flow__node").first()).toBeVisible()
    expect(await page.locator(".react-flow__node").count()).toBeGreaterThan(0)
  })

  // 지키는 것: 관계도에서 제품 라인별로 좁혀 볼 수 있다
  test("제품 라인 필터 칩이 5개 이상 노출된다", async ({ page }) => {
    await switchTasksView(page, "관계도")
    await expect(
      page.getByRole("button", { name: "전체" }).first()
    ).toBeVisible()
    for (const product of ["제품 A", "제품 B", "제품 C", "공통 R&D"]) {
      await expect(
        page.getByText(product, { exact: true }).first()
      ).toBeVisible()
    }
  })

  // 지키는 것: 관계도의 업무 노드를 두 번 누르면 그 업무 상세로 간다 — 맨 위 노드도 도구 막대에
  // 깔리지 않아 누를 수 있다(2026-10-29 CI 에서 깔렸던 것)
  test("REGRESSION: 캔버스 업무 더블클릭 → 실제 UUID 상세 경로", async ({
    page,
  }) => {
    await switchTasksView(page, "관계도")
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
