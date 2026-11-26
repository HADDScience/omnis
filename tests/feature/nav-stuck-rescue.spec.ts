/**
 * 오프라인 탭 이동 멈춤(2026-11-25 제보) — 근거 ~/work/omnis-reports/nav-stuck-offline-261125.md
 *
 * 지키는 것
 * - 탭을 눌렀는데 이동이 멈추면(RSC 실패 → Next 의 문서 이동이 끝나지 않음) 8초 뒤 누른 표시가 원래대로 돌아오고 「연결이 느립니다 · 다시 시도」 가 보인다
 * - 10초 안에 화면이 안 바뀌면 그 화면을 새로 열어 도착한다(한 번만)
 * - RSC 실패는 /api/errors 에 「탭 이동 실패」 로 남는다
 * - 지금 탭을 다시 누르면 바로 원래대로 — 라우터가 멈췄으면 지금 화면을 새로 연다
 * - 오프라인이 되면 오프라인 띠가 보이고, 다시 연결되면 사라진다
 */
import { expect, test, type Page, type Route } from "@playwright/test"
import { login } from "./_setup"

const nav = (page: Page) => page.getByRole("navigation", { name: "주 메뉴" }).first()

/** /tasks 의 RSC 요청은 실패시키고, 이어지는 문서 이동 첫 번은 응답 없이 붙잡아 둔다(폰에서 끝나지 않던 이동) */
async function stallTasks(page: Page) {
  const held: Route[] = []
  let documents = 0
  await page.route(
    (u) => u.pathname === "/tasks",
    async (route) => {
      const req = route.request()
      if (req.isNavigationRequest()) {
        documents++
        if (documents === 1) {
          held.push(route)
          return
        }
        return route.continue()
      }
      if ((await req.headerValue("rsc")) || new URL(req.url()).searchParams.has("_rsc"))
        return route.abort("internetdisconnected")
      return route.continue()
    }
  )
  return { held, documents: () => documents }
}

/**
 * 문서 이동이 붙잡혀 있는 동안 Playwright 의 locator · evaluate 는 그 이동이 끝나기를 기다린다.
 * 그래서 CDP 로 지금 문서를 직접 읽는다(조사 보고서 시나리오 G 와 같은 방법)
 */
async function domState(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  return async () => {
    const r = await cdp.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        const nav = document.querySelector('nav[aria-label="주 메뉴"]')
        const current = nav?.querySelector('[aria-current="page"]')?.textContent?.trim() ?? null
        const stalled = document.documentElement.hasAttribute("data-nav-stalled")
        const status = [...document.querySelectorAll('[role="status"]')].map((e) => e.textContent?.trim()).join("|")
        return { path: location.pathname, current, status, stalled }
      })()`,
    })
    // 새 문서로 넘어가는 순간에는 읽지 못한다 — 빈 값으로 넘기고 다음에 다시 읽는다
    if (r.exceptionDetails || !r.result.value) return { path: "", current: null, status: "", stalled: false }
    return r.result.value as { path: string; current: string | null; status: string; stalled: boolean }
  }
}

async function recordErrors(page: Page) {
  const reports: { kind?: string; message?: string }[] = []
  await page.route("**/api/errors", async (route) => {
    reports.push(JSON.parse(route.request().postData() ?? "{}"))
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
  })
  return reports
}

test.describe("탭 이동 멈춤 풀기 @nav", () => {
  test.slow()

  // 지키는 것: 멈춘 이동은 8초 뒤 표시가 돌아오고, 10초 안에 새로 열려 도착한다. RSC 실패가 보고된다
  test("멈춘 이동 — 표시 되돌림 · 연결이 느립니다 · 새로 열어 도착", async ({ page }) => {
    await login(page, "팀장")
    await page.waitForLoadState("networkidle")
    const reports = await recordErrors(page)
    const stall = await stallTasks(page)
    const dom = await domState(page)

    await nav(page).getByRole("link", { name: "업무" }).click({ noWaitAfter: true })
    // 붙잡힌 이동 동안 Playwright 쪽 기다림(expect.poll · locator)이 늦게 돈다 — CDP 로 250ms 마다 직접 모은다
    const t0 = Date.now()
    const seen: { t: number; path: string; current: string | null; slow: boolean; stalled: boolean }[] = []
    while (Date.now() - t0 < 14_000) {
      const d = await dom()
      seen.push({ t: Date.now() - t0, path: d.path, current: d.current, slow: d.status.includes("연결이 느립니다"), stalled: d.stalled })
      if (d.path === "/tasks" && d.current === "업무") break
      await new Promise((r) => setTimeout(r, 250))
    }
    const log = JSON.stringify(seen)
    // 누른 직후 — 업무가 켜지고 주소는 채팅 그대로
    expect(seen.find((x) => x.t < 3_000 && x.path === "/chat")?.current, log).toBe("업무")
    // 8초 뒤 — 「연결이 느립니다 · 다시 시도」, 알약을 거둔다(주소는 아직 채팅)
    const slow = seen.find((x) => x.slow)
    expect(slow, log).toBeTruthy()
    expect(slow!.t, log).toBeGreaterThanOrEqual(7_500)
    expect(slow!.path, log).toBe("/chat")
    expect(slow!.stalled, log).toBe(true)
    await page.waitForURL("**/tasks", { timeout: 15_000 })
    expect(stall.documents()).toBe(2)
    await expect(page.getByRole("status").filter({ hasText: "연결이 느립니다" })).toHaveCount(0)
    await expect
      .poll(() => reports.some((r) => r.kind === "nav_failed" && /Failed to fetch RSC payload/.test(r.message ?? "")))
      .toBe(true)
  })

  // 지키는 것: 지금 탭을 다시 누르면 바로 원래대로 — 라우터가 멈췄으면 지금 화면(채팅)을 새로 연다
  test("지금 탭을 누르면 바로 원래대로", async ({ page }) => {
    await login(page, "팀장")
    await page.waitForLoadState("networkidle")
    await recordErrors(page)
    const stall = await stallTasks(page)
    const dom = await domState(page)
    await nav(page).getByRole("link", { name: "업무" }).click({ noWaitAfter: true })
    await expect.poll(async () => (await dom()).current, { intervals: [100] }).toBe("업무")
    await page.waitForTimeout(1_000)
    // 붙잡힌 이동 중이라 click 대신 문서에서 직접 누른다
    const cdp = await page.context().newCDPSession(page)
    await cdp.send("Runtime.evaluate", {
      expression: `document.querySelector('nav[aria-label="주 메뉴"] a[href$="/chat"]').click()`,
    })
    // 채팅 문서를 새로 열어 붙잡힌 업무 이동을 버린다 — 채팅에 그대로, 「연결이 느립니다」 도 새로 열기도 없다
    await page.waitForLoadState("load")
    await expect(nav(page).getByRole("link", { name: "채팅" })).toHaveAttribute("aria-current", "page")
    await page.waitForTimeout(11_000)
    expect(new URL(page.url()).pathname).toBe("/chat")
    await expect(page.getByRole("status").filter({ hasText: "연결이 느립니다" })).toHaveCount(0)
    expect(stall.documents()).toBe(1)
  })

  // 지키는 것: 오프라인이 되면 띠가 보이고, 다시 연결되면 사라진다
  test("오프라인 띠", async ({ page, context }) => {
    await login(page, "팀장")
    await context.setOffline(true)
    await expect(page.getByRole("status").filter({ hasText: "오프라인" })).toBeVisible()
    await context.setOffline(false)
    await expect(page.getByRole("status").filter({ hasText: "오프라인" })).toHaveCount(0)
  })
})
