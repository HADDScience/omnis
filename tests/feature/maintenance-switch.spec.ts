/**
 * 점검 스위치(lib/maintenance · proxy.ts · components/layout/notice-banner.tsx).
 *
 * 서버 하나를 여러 시험이 같이 쓰므로 서버 전체를 점검으로 돌리지 않는다. 대신 흉내 쿠키를 가진
 * 브라우저 하나만 스위치 값을 그렇게 본다 — 서버가 MAINTENANCE_ALLOW_SIMULATE=1 일 때만(CI · 로컬).
 * 규칙의 단위 시험: lib/maintenance/maintenance.test.ts
 */
import { devices, expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test"
import { login } from "./_setup"

const SIMULATE = process.env.MAINTENANCE_ALLOW_SIMULATE === "1"
const BYPASS = process.env.MAINTENANCE_BYPASS_TOKEN
const BASE = process.env.BASE_URL ?? "http://localhost:3000"

function simCookie(value: { mode: string; message?: string; updatedAt?: string }) {
  return {
    name: "omnis_maintenance_sim",
    value: encodeURIComponent(JSON.stringify(value)),
    url: BASE,
  }
}

async function setSwitch(ctx: BrowserContext, value: { mode: string; message?: string; updatedAt?: string }) {
  await ctx.addCookies([simCookie(value)])
}

/** 화면 위쪽의 유리 요소(떠 있는 nav · 알림 원 · 오른쪽 패널)가 띠 아래에서 시작하는가 */
async function expectNothingUnderBanner(page: Page) {
  const banner = page.locator("[data-notice-banner]")
  await expect(banner).toBeVisible()
  const bottom = (await banner.boundingBox())!.y + (await banner.boundingBox())!.height
  const tops = await page.locator(".glass").evaluateAll((els) =>
    els
      .filter((el) => {
        const r = el.getBoundingClientRect()
        const s = getComputedStyle(el)
        return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && r.top < 200
      })
      .map((el) => el.getBoundingClientRect().top),
  )
  for (const top of tops) expect(top, "유리 요소가 띠 아래에서 시작한다").toBeGreaterThanOrEqual(bottom - 0.5)
}

test.describe("점검 스위치", () => {
  test.skip(!SIMULATE, "서버가 MAINTENANCE_ALLOW_SIMULATE=1 로 떠 있을 때만")

  test("꺼져 있으면 띠도 점검 화면도 없다", async ({ request }) => {
    const status = await request.get("/api/status")
    expect(status.status()).toBe(200)
    expect((await status.json()).mode).toBe("off")
    expect((await request.get("/login")).status()).toBe(200)
  })

  test("maintenance — 화면은 정적 점검 페이지 503, API · 상태 확인 · 정적 자원은 proxy 를 거치지 않는다", async ({ browser }) => {
    const ctx = await browser.newContext()
    await setSwitch(ctx, { mode: "maintenance", message: "DB 점검 <중>", updatedAt: "2026-11-06T01:00:00.000Z" })
    const api = ctx.request

    for (const path of ["/", "/login", "/tasks"]) {
      const res = await api.get(path, { maxRedirects: 0 })
      expect(res.status(), path).toBe(503)
      expect(res.headers()["retry-after"], path).toBe("120")
      expect(res.headers()["content-type"]).toContain("text/html")
      const html = await res.text()
      expect(html).toContain("DB 점검 &lt;중&gt;")
      expect(html, "앱 번들을 싣지 않는다").not.toContain("/_next/static")
    }

    // API 는 막지 않는다(호출 수 — lib/maintenance/rules.ts). 열린 화면은 새로고침으로 멈춘다(아래 시험)
    expect((await api.get("/api/tasks")).status(), "로그인 없이 원래 응답").toBe(401)

    expect((await api.get("/api/health")).status()).toBe(200)
    expect((await api.get("/sw.js")).status()).toBe(200)
    expect((await api.get("/icon-192.png")).status()).toBe(200)
    const status = await api.get("/api/status")
    expect((await status.json()).mode).toBe("maintenance")
    expect(status.headers()["cache-control"], "흉내 값은 공유 캐시에 올리지 않는다").toBe("no-store")

    // 브라우저로 열어도 같은 화면이다
    const page = await ctx.newPage()
    const res = await page.goto("/tasks")
    expect(res?.status()).toBe(503)
    await expect(page.getByRole("heading", { name: "점검 중입니다" })).toBeVisible()
    await expect(page.locator("[data-maintenance-message]")).toHaveText("DB 점검 <중>")
    await ctx.close()
  })

  test("maintenance — 우회 쿼리로 쿠키를 받은 관리자만 들어가고, 띠로 점검 중임을 본다", async ({ browser }) => {
    test.skip(!BYPASS, "MAINTENANCE_BYPASS_TOKEN 이 있을 때만")
    const ctx = await browser.newContext()
    await setSwitch(ctx, { mode: "maintenance", message: "배포 확인 중" })
    const page = await ctx.newPage()

    expect((await page.goto("/login?maintenance_bypass=wrong-token-wrong-token"))?.status()).toBe(503)

    const res = await page.goto(`/login?maintenance_bypass=${BYPASS}`)
    expect(res?.status()).toBe(200)
    expect(new URL(page.url()).searchParams.has("maintenance_bypass"), "토큰을 주소에서 지운다").toBe(false)
    const cookie = (await ctx.cookies()).find((c) => c.name === "omnis_maintenance_bypass")
    expect(cookie?.httpOnly).toBe(true)

    await login(page, "팀장")
    await expect(page.locator('[data-notice-banner="maintenance"]')).toContainText("점검 중 · 우회 접속")
    await expect(page.locator('[data-notice-banner="maintenance"]')).toContainText("배포 확인 중")
    await ctx.close()
  })

  test("maintenance — 이미 열린 화면은 1분 안에 스스로 새로고침해 점검 화면으로 간다", async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.clock.install()
    await login(page, "사원1")
    await expect(page.getByRole("heading", { name: "점검 중입니다" })).toHaveCount(0)

    await setSwitch(ctx, { mode: "maintenance", message: "긴급 수정 배포 중" })
    await page.clock.fastForward(26_000)
    await expect(page.getByRole("heading", { name: "점검 중입니다" })).toBeVisible()
    await expect(page.locator("[data-maintenance-message]")).toHaveText("긴급 수정 배포 중")
    await ctx.close()
  })

  async function bannerOnOpenScreen(browser: Browser, options: Parameters<Browser["newContext"]>[0]) {
    const ctx = await browser.newContext(options)
    const page = await ctx.newPage()
    await page.clock.install()
    await login(page, "팀장")
    await expect(page.locator("[data-notice-banner]")).toHaveCount(0)

    // 이미 열린 화면 — 스위치를 바꾼 뒤 다음 폴링(25초) 안에 띠가 나타난다
    await setSwitch(ctx, { mode: "banner", message: "오늘 18시에 5분 점검합니다", updatedAt: "2026-11-06T02:00:00.000Z" })
    await page.clock.fastForward(26_000)
    await expect(page.locator('[data-notice-banner="banner"]')).toContainText("오늘 18시에 5분 점검합니다")
    await expectNothingUnderBanner(page)

    // 닫으면 같은 공지는 다시 나오지 않고, 문구가 바뀌면 다시 나온다
    await page.getByRole("button", { name: "공지 닫기" }).click()
    await expect(page.locator("[data-notice-banner]")).toHaveCount(0)
    await page.clock.fastForward(26_000)
    await expect(page.locator("[data-notice-banner]")).toHaveCount(0)
    await setSwitch(ctx, { mode: "banner", message: "점검이 19시로 늦춰졌습니다", updatedAt: "2026-11-06T03:00:00.000Z" })
    await page.clock.fastForward(26_000)
    await expect(page.locator('[data-notice-banner="banner"]')).toContainText("19시")

    // 끄면 사라진다
    await setSwitch(ctx, { mode: "off" })
    await page.clock.fastForward(26_000)
    await expect(page.locator("[data-notice-banner]")).toHaveCount(0)
    await ctx.close()
  }

  test("banner — PC: 열린 화면에도 1분 안에 띠가 뜨고 유리 nav 를 덮지 않는다", async ({ browser }) => {
    await bannerOnOpenScreen(browser, { viewport: { width: 1440, height: 900 } })
  })

  test("banner — 폰: 같은 띠가 머리줄 위에 뜨고 겹치지 않는다", async ({ browser }) => {
    const { defaultBrowserType: _ignored, ...iphone } = devices["iPhone 13"]
    void _ignored
    await bannerOnOpenScreen(browser, iphone)
  })
})
