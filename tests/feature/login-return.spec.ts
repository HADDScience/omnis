/**
 * 로그인 뒤 원래 화면으로 — 로그아웃 상태로 연 링크(카톡 공지의 설문 링크 등)는 로그인 뒤 그 화면으로 돌아온다.
 * 규칙: lib/login-return.ts(시험 lib/login-return.test.ts). 2026-11-12 핫픽스
 *
 *   pnpm run test:e2e:local tests/feature/login-return.spec.ts
 */
import { expect, test } from "@playwright/test"
import { DEMO_PASSWORD, hideSurveyBanner } from "./_setup"

test.describe("로그인 뒤 원래 화면으로 @auth", () => {
  // 지키는 것: 보호된 화면은 서버가 307 로 로그인 화면에 보내며 원래 주소를 callbackUrl 에 싣는다
  test("로그아웃 상태 요청 — 307 · Location 에 callbackUrl", async ({ request }) => {
    const res = await request.get("/settings/ai-survey?from=kakao", { maxRedirects: 0 })
    expect(res.status()).toBe(307)
    const loc = new URL(res.headers()["location"], "http://x")
    expect(loc.pathname).toBe("/login")
    expect(loc.searchParams.get("callbackUrl")).toBe("/settings/ai-survey?from=kakao")
    // 공개 화면은 그대로
    expect((await request.get("/login", { maxRedirects: 0 })).status()).toBe(200)
  })

  // 지키는 것: 로그아웃 → 설문 링크 → 로그인 → 설문 화면
  test("설문 링크 → 로그인 → 설문 화면", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await hideSurveyBanner(page)
    await page.goto("/settings/ai-survey")
    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fsettings%2Fai-survey$/)
    await page.getByRole("textbox", { name: "이름" }).fill("사원1")
    await page.getByRole("textbox", { name: "비밀번호" }).fill(DEMO_PASSWORD)
    await page.getByRole("button", { name: "로그인", exact: true }).click()
    await page.waitForURL("**/settings/ai-survey", { timeout: 30_000 })
    await expect(page.locator("[data-ai-survey]")).toBeVisible({ timeout: 30_000 })
  })

  // 지키는 것: 바깥 주소는 따라가지 않는다 — 로그인 뒤 기본 화면(/chat)
  test("오픈 리다이렉트 — //evil.example 은 무시하고 /chat", async ({ page }) => {
    await hideSurveyBanner(page)
    await page.goto(`/login?callbackUrl=${encodeURIComponent("//evil.example/x")}`)
    await page.getByRole("textbox", { name: "이름" }).fill("사원1")
    await page.getByRole("textbox", { name: "비밀번호" }).fill(DEMO_PASSWORD)
    await page.getByRole("button", { name: "로그인", exact: true }).click()
    await page.waitForURL("**/chat", { timeout: 30_000 })
    expect(new URL(page.url()).host).not.toContain("evil")
  })
})
