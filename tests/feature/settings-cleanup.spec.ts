/**
 * 마이 화면 정리(2026-11-11) — 일반 탭(테마 · 키보드 단축키), 앱 정보(버전 · 약관 링크, 시스템 설정 · 사용 기록 안내 걷음),
 * 개인정보 처리방침 · 서비스 이용약관(로그인 없이 열린다 · 회사 정보는 DB 의 회사 기본정보에서).
 * 임시 비밀번호 안내 · 경고 점은 password-guard.spec.ts.
 */
import { expect, test, type Page } from "@playwright/test"
import { quickLogin } from "./_setup"

const PC = { viewport: { width: 1280, height: 860 } }
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }
const tab = (page: Page, name: string) => page.getByRole("tab", { name })

async function quiet(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("omnis:nudge-off:install", "1")
    localStorage.setItem("omnis:nudge-off:push", "1")
  })
}

test.describe("일반 탭", () => {
  test("PC — 첫 탭이고 테마 · 바꿀 수 있는 단축키 · 화면마다 정해진 키가 보인다", async ({ browser }) => {
    const ctx = await browser.newContext(PC)
    const page = await ctx.newPage()
    await quiet(page)
    await quickLogin(page, "사원1")
    await page.goto("/settings")
    await expect(page.getByRole("tab").first()).toHaveText("일반")
    await expect(tab(page, "일반")).toHaveAttribute("aria-selected", "true")
    const general = page.locator("[data-general-settings]")
    await expect(general.getByRole("button", { name: /테마/ })).toBeVisible()
    await expect(general.locator("[data-keyboard-shortcuts]")).toBeVisible()
    // 바꿀 수 있는 단축키 셋
    await expect(general.locator("[data-shortcut]")).toHaveCount(3)
    const fixed = general.locator("[data-fixed-keys]")
    await expect(fixed).toBeVisible()
    for (const text of ["채팅 입력창", "줄바꿈", "대화 검색", "사진 크게 보기", "Shift", "F10"]) await expect(fixed).toContainText(text)
    // 테마 · 단축키는 마이 위의 바로가기 목록에서 빠졌다
    await expect(page.locator("[data-keyboard-shortcuts]")).toHaveCount(1)
    await expect(page.getByRole("button", { name: /테마/ })).toHaveCount(1)
    await ctx.close()
  })

  test("폰 — 테마만 보이고 단축키 두 카드는 숨는다", async ({ browser }) => {
    const ctx = await browser.newContext(PHONE)
    const page = await ctx.newPage()
    await quiet(page)
    await quickLogin(page, "사원1")
    await page.goto("/settings")
    const general = page.locator("[data-general-settings]")
    await expect(general.getByRole("button", { name: /테마/ })).toBeVisible()
    await expect(general.locator("[data-keyboard-shortcuts]")).toBeHidden()
    await expect(general.locator("[data-fixed-keys]")).toBeHidden()
    await expect(page.getByRole("tab")).toHaveText(["일반", "알림 설정", "사용량", "앱 정보"])
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await ctx.close()
  })
})

test.describe("앱 정보", () => {
  test("구성원 — 버전 · 배포 · 약관 링크만. 시스템 설정 · 사용 기록 안내 · 관리 링크는 없다", async ({ page }) => {
    await quiet(page)
    await quickLogin(page, "사원1")
    await page.goto("/settings?tab=info")
    const version = page.locator("[data-app-version]")
    await expect(version).toContainText("앱 버전")
    await expect(version).toContainText(/\d+\.\d+\.\d+/)
    // 배포 커밋(7자리) 또는 로컬 빌드 · 날짜
    await expect(version).toContainText(/([0-9a-f]{7}|로컬 빌드)/)
    await expect(version).toContainText(/\d{4}-\d{2}-\d{2}/)
    await expect(page.getByText("시스템 설정")).toHaveCount(0)
    await expect(page.locator("[data-ui-metrics-notice]")).toHaveCount(0)
    await expect(page.locator("[data-admin-links]")).toHaveCount(0)
    await page.getByRole("link", { name: "개인정보 처리방침" }).click()
    await page.waitForURL("**/privacy")
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("개인정보 처리방침")
  })

  test("관리자 — 관리 화면 링크 한 줄이 남는다", async ({ page }) => {
    await quiet(page)
    await quickLogin(page, "팀장")
    await page.goto("/settings?tab=info")
    const admin = page.locator("[data-admin-links]")
    await expect(admin.getByRole("link")).toHaveText(["기능 요청 보기", "AI 비용 상한", "배포별 측정 보기"])
  })
})

test.describe("약관 · 개인정보 처리방침", () => {
  test("로그인 없이 열리고, 회사 정보는 회사 기본정보(데모 시드)에서 온다", async ({ page }) => {
    await page.goto("/privacy")
    await expect(page).toHaveURL(/\/privacy$/)
    const doc = page.locator("[data-legal-doc=privacy]")
    await expect(doc.getByRole("heading", { level: 1 })).toHaveText("개인정보 처리방침")
    for (const text of ["처리 목적", "카카오톡 이식 데이터", "보유 기간", "처리 위탁 · 국외 이전", "Vercel", "Neon", "Cloudflare", "OpenAI", "Google", "Anthropic", "이용자의 권리", "개인정보 보호책임자"]) {
      await expect(doc).toContainText(text)
    }
    // 데모 시드의 익명 회사 · 대표(prisma/demo-seed.ts)
    await expect(doc).toContainText("데모바이오")
    await expect(doc).toContainText("팀장 (대표)")
    // 사용 기록 안내가 여기로 왔다
    await expect(doc.locator("#ui-metrics [data-ui-metrics-notice]")).toContainText("모으는 것")
    // 초안 표시는 본문에 두지 않는다
    await expect(doc).not.toContainText("초안")

    await page.getByRole("link", { name: "서비스 이용약관" }).first().click()
    await page.waitForURL("**/terms")
    const terms = page.locator("[data-legal-doc=terms]")
    await expect(terms.getByRole("heading", { level: 1 })).toHaveText("서비스 이용약관")
    await expect(terms).toContainText("데모바이오")
    await expect(terms).not.toContainText("초안")
  })

  test("로그인 화면 아래에 작은 링크 둘", async ({ page }) => {
    await page.goto("/login")
    const nav = page.getByRole("navigation", { name: "약관" })
    await expect(nav.getByRole("link")).toHaveText(["서비스 이용약관", "개인정보 처리방침"])
    await nav.getByRole("link", { name: "개인정보 처리방침" }).click()
    await page.waitForURL("**/privacy")
  })

  test("폰에서 위탁 표는 표 안에서만 가로로 밀린다", async ({ browser }) => {
    const ctx = await browser.newContext(PHONE)
    const page = await ctx.newPage()
    await page.goto("/privacy")
    await expect(page.locator("[data-legal-doc=privacy]")).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await ctx.close()
  })
})
