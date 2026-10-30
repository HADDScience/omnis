import { test, expect } from "@playwright/test"

/**
 * 새 랜딩(mydocs/plans/2026-10-29-landing-v2.md) — 로그인하지 않은 사람이 `/` 에서 보는 것.
 * 로그인을 하지 않는다 — 이 파일의 시험은 모두 새 브라우저 문맥(쿠키 없음)에서 돈다.
 */
test.describe("landing", () => {
  test("비로그인 `/` — 히어로, 들어가기는 /login, 문의는 회사 메일", async ({ page }) => {
    await page.goto("/")
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole("heading", { level: 1 })).toContainText("HADD Science 는")

    const enter = page.getByRole("link", { name: /들어가기/ })
    // 머리줄 · 히어로 · 마무리 — 셋 다 로그인으로 간다
    expect(await enter.count()).toBeGreaterThanOrEqual(3)
    for (const link of await enter.all()) await expect(link).toHaveAttribute("href", /\/login$/)

    await expect(page.getByRole("link", { name: /문의/ })).toHaveAttribute(
      "href",
      "mailto:jwoochang@haddscience.com",
    )
  })

  test("예전 랜딩은 /landing/legacy 에 남고 검색엔진에는 내보내지 않는다", async ({ page }) => {
    await page.goto("/landing/legacy")
    await expect(page).toHaveURL(/\/landing\/legacy$/)
    await expect(page.getByRole("heading", { level: 1 })).toContainText("흩어진 업무를")
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/)
  })

  test("시연은 화면에 보이면 재생되고 옴니스 API 를 부르지 않는다", async ({ page }) => {
    const agentCalls: string[] = []
    page.on("request", (request) => {
      if (/\/api\/(agent|omnis)/.test(request.url())) agentCalls.push(request.url())
    })
    await page.goto("/")
    const demo = page.locator('[data-tour-demo="create-task"]')
    await demo.scrollIntoViewIfNeeded()
    // 대본 1 의 끝(11.4초)에 옴니스가 「만들었어요」 라고 답한다
    await expect(demo).toContainText("업무를 만들었어요", { timeout: 20_000 })
    expect(agentCalls).toEqual([])
  })
})
