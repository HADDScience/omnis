import { test, expect } from "@playwright/test"

/**
 * 랜딩(mydocs/plans/2026-10-30-landing-motion-story.md) — 로그인하지 않은 사람이 `/` 에서 보는 것.
 * 로그인을 하지 않는다 — 이 파일의 시험은 모두 새 브라우저 문맥(쿠키 없음)에서 돈다.
 */
test.describe("landing", () => {
  test("비로그인 `/` — 히어로, 들어가기는 /login, 문의는 회사 메일", async ({ page }) => {
    await page.goto("/")
    await expect(page).toHaveURL(/\/$/)
    // 히어로 문장은 스크롤 장면이라 첫 화면(아이콘)에서는 숨어 있다
    await expect(page.locator(".story-copy h1")).toContainText("HADD Science는")
    // 시연 안의 실제 방 머리(RoomHeader)도 h1 을 그린다 — 읽기 트리에 나오면 페이지 제목이 둘이 된다
    await expect(page.getByRole("heading", { level: 1, name: "새 대화" })).toHaveCount(0)

    const enter = page.getByRole("link", { name: /들어가기/ })
    // 머리줄 · 마무리 — 둘 다 로그인으로 간다
    expect(await enter.count()).toBeGreaterThanOrEqual(2)
    for (const link of await enter.all()) await expect(link).toHaveAttribute("href", /\/login$/)

    await expect(page.getByRole("link", { name: /문의하기/ })).toHaveAttribute(
      "href",
      /^mailto:jwoochang@haddscience\.com/,
    )
  })

  test("지난 랜딩은 /landing/v2 · /landing/legacy 에 남고 검색엔진에는 내보내지 않는다", async ({ page }) => {
    await page.goto("/landing/v2")
    await expect(page.getByRole("heading", { level: 1 })).toContainText("HADD Science 는")
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/)

    await page.goto("/landing/legacy")
    await expect(page).toHaveURL(/\/landing\/legacy$/)
    await expect(page.getByRole("heading", { level: 1 })).toContainText("흩어진 업무를")
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/)
  })

  test("업무 시연은 실제 메신저 컴포넌트로 재생되고 옴니스 API 를 부르지 않는다", async ({ page }) => {
    const agentCalls: string[] = []
    page.on("request", (request) => {
      if (/\/api\/(agent|omnis)/.test(request.url())) agentCalls.push(request.url())
    })
    await page.goto("/")
    // 시연은 화면을 채운 뒤에 돈다 — 고정 구간 안으로 바로 옮긴다
    await page.evaluate(() => {
      const track = document.querySelector(".film-scroll-track")
      if (track) window.scrollTo(0, window.scrollY + track.getBoundingClientRect().top + window.innerHeight * 0.75)
    })
    const film = page.locator("[data-messenger].product-window")
    // 10.5초에 첫 지시가 실제 말풍선으로, 12.5초에 옴니스가 되묻는다
    await expect(film.locator("[data-film-message]").first()).toBeVisible({ timeout: 20_000 })
    await expect(film).toContainText("어느 고객사를 위한 제안서인가요?", { timeout: 20_000 })
    expect(agentCalls).toEqual([])
  })
})
