import { test, expect } from "@playwright/test"
import { login } from "./_setup"

test.describe("HADD DB (Omnis 지식 허브)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "팀장")
  })

  test("HADD DB 메뉴 클릭 → /omnis 진입", async ({ page }) => {
    await page.getByRole("link", { name: "HADD DB" }).click()
    await expect(page).toHaveURL(/\/omnis$/)
    // 2026-09-16(PR #29) 에 h1 이 바뀌었다. 계획서의 결정 기록:
    // "회사의 모든 지식, 한 번의 검색으로." 는 검색이 카드만 훑는 지금 참이 아니다
    // — mydocs/plans/2026-09-16-hadd-db-landing-context-first.md
    await expect(
      page.getByRole("heading", { name: /회사가 쌓아 온 것/ })
    ).toBeVisible()
  })

  test("3개 카테고리 칩(기업정보·인력현황·지식재산권)이 보인다", async ({
    page,
  }) => {
    await page.goto("/omnis")
    // 칩 줄은 카드가 있을 때만 그려진다 — 같은 결정 기록의 "카드 UI 를 지우지 않고
    // 감춘다(totalCards > 0 이면 예전 화면 그대로)". 카드 0건인 DB(운영 스냅샷 등)에서는
    // 없는 것이 맞으므로 실패가 아니라 건너뛴다.
    const chipRow = page.getByRole("link", { name: /^즐겨찾기\s*·\s*\d+$/ })
    test.skip(!(await chipRow.isVisible()), "카드 0건인 DB — 칩 줄이 감춰진다")
    for (const category of ["기업정보", "인력현황", "지식재산권"]) {
      await expect(
        page.getByRole("link", {
          name: new RegExp(`^${category}\\s*·\\s*\\d+$`),
        })
      ).toBeVisible()
    }
  })

  test("API에서 카테고리 조회 시 200 + 3건 이상 반환", async ({ page }) => {
    const res = await page.evaluate(async () => {
      const r = await fetch("/api/omnis")
      return { ok: r.ok, count: ((await r.json()) as unknown[]).length }
    })
    expect(res.ok).toBe(true)
    expect(res.count).toBeGreaterThanOrEqual(3)
  })
})
