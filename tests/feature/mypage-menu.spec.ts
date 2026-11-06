/**
 * 마이 화면 메뉴(2026-11-06) — 프로필 카드(직급 · 소셜 표시) → 프로필 설정, 검색 줄 대신 앱 설치 줄,
 * 설치 1단계(인앱 브라우저 → Safari · Chrome 로 넘기기)와 넘어온 뒤 2단계 잇기.
 * 넘기는 주소의 규칙 단위 시험: lib/install-handoff.test.ts. 스킴이 실제 기기에서 열리는지는 여기서 보지 못한다.
 * 소셜 연결을 시험 DB 에 직접 넣는다 — 로컬 DB(CI · e2e-local)에서만 돈다.
 */
import { randomUUID } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { login } from "./_setup"

const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")
const prisma = LOCAL_DB ? new PrismaClient() : (null as unknown as PrismaClient)
const tag = randomUUID().slice(0, 8)

const UA = {
  iosKakao: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.8.5",
  iosSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  androidKakao: "Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36;KAKAOTALK 2410850",
}
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }

/** 첫 화면 권유(앱 설치 · 기기 알림)가 대화창으로 가리지 않게 */
async function quiet(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("omnis:nudge-off:install", "1")
    localStorage.setItem("omnis:nudge-off:push", "1")
  })
}

const installRow = (page: Page) => page.locator("[data-install-row]")
const guide = (page: Page) => page.locator("[data-install-guide]")

test.describe("프로필 카드 · 프로필 설정", () => {
  test.skip(!LOCAL_DB, "시험 DB 를 직접 고친다")
  test.describe.configure({ mode: "serial" })

  test.beforeAll(async () => {
    const user = await prisma.user.findFirstOrThrow({ where: { name: "사원3" } })
    await prisma.userIdentity.deleteMany({ where: { userId: user.id } })
    await prisma.userIdentity.createMany({
      data: [
        { userId: user.id, provider: "kakao", providerAccountId: `e2e-kakao-${tag}` },
        { userId: user.id, provider: "google", providerAccountId: `e2e-google-${tag}`, email: "e2e@example.com" },
      ],
    })
  })
  test.afterAll(async () => {
    await prisma?.userIdentity.deleteMany({ where: { providerAccountId: { in: [`e2e-kakao-${tag}`, `e2e-google-${tag}`] } } })
    await prisma?.$disconnect()
  })

  for (const [label, device] of [["PC", { viewport: { width: 1280, height: 800 } }], ["폰", PHONE]] as const) {
    test(`${label} — 카드에 역할 대신 직급, 이름 옆에 연결된 소셜만, 누르면 프로필 설정`, async ({ browser }) => {
      const ctx = await browser.newContext(device)
      const page = await ctx.newPage()
      await quiet(page)
      await login(page, "사원3")
      await page.goto("/settings")
      const card = page.locator("[data-profile-card]")
      await expect(card.locator("[data-profile-title]")).toHaveText("주임")
      await expect(card).not.toContainText("MEMBER")
      await expect(card).not.toContainText("ADMIN")
      await expect(card.locator("[data-social-badge]")).toHaveCount(2)
      await expect(card.getByRole("img", { name: "Google 연결됨" })).toBeVisible()
      await expect(card.getByRole("img", { name: "카카오 연결됨" })).toBeVisible()
      const box = (await card.boundingBox())!
      expect(box.height).toBeGreaterThanOrEqual(44)

      await card.click()
      await page.waitForURL("**/settings/profile")
      const info = page.locator("[data-profile-info]")
      await expect(info).toContainText("사원3")
      await expect(info.locator("[data-profile-title]")).toHaveText("주임")
      // 비밀번호 변경은 여기서 간다 — 화면은 /account/password 그대로, 돌아오면 프로필 설정
      await page.locator("[data-password-link]").click()
      await page.waitForURL("**/account/password")
      await page.getByRole("link", { name: "프로필 설정으로 돌아가기" }).click()
      await page.waitForURL("**/settings/profile")
      // 소셜 연결 / 해제 카드(LinkedAccounts)는 소셜 로그인 키가 있는 서버에서만 그려진다 — 시험 서버에는 없다
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(device.viewport.width)
      await ctx.close()
    })
  }

  test("소셜 연결이 막혀 돌아오면 프로필 설정에 까닭이 보인다", async ({ page }) => {
    await quiet(page)
    await login(page, "사원3")
    await page.goto("/settings?error=taken")
    await page.waitForURL("**/settings/profile?error=taken")
    await expect(page.locator("[data-link-error]")).toContainText("다른 Omnis 계정")
  })
})

test.describe("검색 줄 대신 앱 설치 줄", () => {
  test("폰 마이 메뉴에 검색 줄이 없고 앱 설치 줄이 있다", async ({ browser }) => {
    const ctx = await browser.newContext(PHONE)
    const page = await ctx.newPage()
    await quiet(page)
    await login(page, "사원1")
    await page.goto("/settings")
    await expect(installRow(page)).toBeVisible()
    await expect(installRow(page)).toContainText("앱 설치")
    await expect(page.getByRole("button", { name: "검색", exact: true })).toHaveCount(0)
    await ctx.close()
  })

  test("홈 화면 아이콘으로 열었으면(standalone) 「설치됨」 이고 눌리지 않는다", async ({ browser }) => {
    const ctx = await browser.newContext({ ...PHONE, userAgent: UA.iosSafari })
    const page = await ctx.newPage()
    await quiet(page)
    await page.addInitScript(() => {
      const real = window.matchMedia.bind(window)
      window.matchMedia = (q: string) => (q.includes("display-mode: standalone") ? ({ ...real(q), matches: true } as MediaQueryList) : real(q))
    })
    await login(page, "사원1")
    await page.goto("/settings")
    await expect(installRow(page).locator("[data-install-state]")).toHaveText("설치됨")
    await expect(installRow(page)).toBeDisabled()
    await ctx.close()
  })
})

test.describe("설치 1단계 — 인앱 브라우저에서 넘기기", () => {
  for (const [label, ua, prefix, target] of [
    ["iPhone 카카오톡", UA.iosKakao, "kakaotalk://web/openExternal?url=", "safari"],
    ["Android 카카오톡", UA.androidKakao, "intent://", "chrome"],
  ] as const) {
    test(`${label} — 1단계 버튼 하나로 같은 페이지를 ${target === "safari" ? "Safari" : "Chrome"} 에서 연다`, async ({ browser }) => {
      const ctx = await browser.newContext({ ...PHONE, userAgent: ua })
      const page = await ctx.newPage()
      await quiet(page)
      await login(page, "사원1")
      await page.goto("/settings")
      await installRow(page).click()
      await expect(guide(page).locator('[data-install-step="1"]')).toBeVisible()
      const link = guide(page).locator(`[data-install-handoff="${target}"]`)
      await expect(link).toBeVisible()
      const href = (await link.getAttribute("href"))!
      expect(href.startsWith(prefix)).toBe(true)
      // 넘어간 브라우저가 2단계를 잇도록 표시가 붙어 있다
      expect(decodeURIComponent(href)).toContain("install=continue")
      if (target === "chrome") expect(href).toContain(";package=com.android.chrome;")
      const box = (await link.boundingBox())!
      expect(box.height).toBeGreaterThanOrEqual(40)
      await expect(guide(page).locator('[data-install-step="2"]')).toContainText("2단계")
      await ctx.close()
    })
  }

  test("이미 Safari 면 1단계를 건너뛰고 홈 화면 추가만 보인다", async ({ browser }) => {
    const ctx = await browser.newContext({ ...PHONE, userAgent: UA.iosSafari })
    const page = await ctx.newPage()
    await quiet(page)
    await login(page, "사원1")
    await page.goto("/settings")
    await installRow(page).click()
    await expect(guide(page).locator('[data-install-step="2"]')).toBeVisible()
    await expect(guide(page).locator('[data-install-step="1"]')).toHaveCount(0)
    await expect(guide(page).getByRole("tab", { name: /iPhone/ })).toHaveAttribute("aria-selected", "true")
    await ctx.close()
  })

  test("넘어온 주소(?install=continue)로 들어오면 어느 화면이든 2단계가 이어서 뜨고, 표시는 주소에서 지운다", async ({ browser }) => {
    const ctx = await browser.newContext({ ...PHONE, userAgent: UA.iosSafari })
    const page = await ctx.newPage()
    await quiet(page)
    await login(page, "사원1")
    await page.goto("/chat?install=continue")
    await expect(guide(page)).toBeVisible({ timeout: 15_000 })
    await expect(guide(page)).toContainText("이어서 홈 화면에 추가")
    await expect(guide(page).locator('[data-install-step="1"]')).toHaveCount(0)
    await expect.poll(() => new URL(page.url()).search).not.toContain("install=")
    await page.reload()
    await page.waitForTimeout(1_500)
    await expect(guide(page)).toHaveCount(0)
    await ctx.close()
  })
})
