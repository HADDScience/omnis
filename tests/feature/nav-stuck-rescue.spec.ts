/**
 * 오프라인 탭 이동 멈춤(2026-11-25 제보) — 근거 ~/work/omnis-reports/nav-stuck-offline-261125.md
 *
 * 지키는 것
 * - 탭을 눌렀는데 이동이 멈추면(RSC 실패 → Next 의 문서 이동이 끝나지 않음) 8초 뒤 누른 표시를 거두고 「연결이 느립니다 · 다시 시도」 가 보인다
 * - 10초 안에 화면이 안 바뀌면 그 화면을 새로 열어 도착한다(한 번만)
 * - RSC 실패는 /api/errors 에 「탭 이동 실패」 로 남는다
 * - 응답이 늦을 때 지금 탭을 다시 누르면 바로 원래대로 — 「연결이 느립니다」 도 새로 열기도 없다
 * - 오프라인이 되면 오프라인 띠가 보이고, 다시 연결되면 사라진다
 *
 * 붙잡힌 문서 이동 동안에는 Playwright 의 locator · evaluate 는 물론 CDP 조회도 길게는 10초쯤 막힌다(2026-11-26 CI).
 * 그래서 멈춤 시험은 페이지 안에 기록기를 심어 sessionStorage 에 사건 순서를 남기고, 도착한 뒤 읽는다.
 */
import { expect, test, type Page } from "@playwright/test"
import { login } from "./_setup"

const nav = (page: Page) => page.getByRole("navigation", { name: "주 메뉴" }).first()

/** 첫 화면이 다 떴다 — 탭바가 보이고 네트워크가 잠잠하다 */
async function settled(page: Page) {
  await expect(nav(page).getByRole("link", { name: "업무" })).toBeVisible()
  await page.waitForLoadState("networkidle")
}

type NavEvent = { e: "click" | "current" | "status" | "stalled" | "load"; v: string; t: number; path: string }

/** 문서마다 붙는 기록기 — 탭 누름 · 켜진 탭 · 상태 줄 · 멈춤 표시를 sessionStorage 에 쌓는다(같은 탭의 다음 문서에서도 읽힌다) */
async function recordNav(page: Page) {
  await page.addInitScript(() => {
    const KEY = "e2e:nav"
    const push = (e: string, v: string) => {
      try {
        const list = JSON.parse(sessionStorage.getItem(KEY) ?? "[]")
        list.push({ e, v, t: Date.now(), path: location.pathname })
        sessionStorage.setItem(KEY, JSON.stringify(list))
      } catch {}
    }
    push("load", location.pathname)
    let current = ""
    let status = ""
    let stalled = false
    const check = () => {
      const nav = document.querySelector('nav[aria-label="주 메뉴"]')
      const c = nav?.querySelector('[aria-current="page"]')?.textContent?.trim() ?? ""
      if (c !== current) push("current", (current = c))
      const s = document.getElementById("omnis-nav-status")?.textContent?.trim() ?? ""
      if (s !== status) push("status", (status = s))
      const st = document.documentElement.hasAttribute("data-nav-stalled")
      if (st !== stalled) push("stalled", String((stalled = st)))
    }
    document.addEventListener(
      "click",
      (ev) => {
        const a = (ev.target as Element | null)?.closest?.('nav[aria-label="주 메뉴"] a')
        if (a) push("click", a.textContent?.trim() ?? "")
      },
      true
    )
    new MutationObserver(check).observe(document, { subtree: true, childList: true, attributes: true, characterData: true })
  })
  return async (): Promise<NavEvent[]> =>
    JSON.parse((await page.evaluate(() => sessionStorage.getItem("e2e:nav"))) ?? "[]")
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

  // 지키는 것: 멈춘 이동은 8초 뒤 표시를 거두고 「연결이 느립니다」, 10초에 새로 열려 도착한다. RSC 실패가 보고된다
  test("멈춘 이동 — 연결이 느립니다 · 새로 열어 도착", async ({ page }) => {
    const reports = await recordErrors(page)
    const read = await recordNav(page)
    // 운영 빌드(CI 의 next start)는 보이는 탭의 RSC 를 미리 받는다 — 미리 받은 것이 있으면 눌러도 요청이 안 나가 멈춤이 재현되지 않는다.
    // 그래서 로그인 전에 걸어 미리 받기도 실패시킨다. /tasks 문서 이동은 첫 번만 붙잡고 두 번째(새로 열기)는 보낸다
    let documents = 0
    await page.route(
      (u) => u.pathname === "/tasks",
      async (route) => {
        const req = route.request()
        if (req.isNavigationRequest()) {
          if (++documents === 1) return // 응답 없이 붙잡아 둔다
          return route.continue()
        }
        return route.abort("internetdisconnected")
      }
    )
    await login(page, "팀장")
    await settled(page)

    await nav(page).getByRole("link", { name: "업무" }).click({ noWaitAfter: true })
    await page.waitForURL("**/tasks", { timeout: 25_000 })
    await expect(nav(page).getByRole("link", { name: "업무" })).toHaveAttribute("aria-current", "page")
    expect(documents).toBe(2)

    const log = await read()
    const at = log.findLast((x) => x.e === "click" && x.v === "업무")!.t
    const after = log.filter((x) => x.t >= at)
    const msg = JSON.stringify(after.map((x) => ({ ...x, t: x.t - at })))
    // 누른 직후 — 업무가 켜진다(주소는 아직 채팅)
    expect(after.find((x) => x.e === "current" && x.v === "업무" && x.path === "/chat" && x.t - at < 3_000), msg).toBeTruthy()
    // 8초 뒤 — 채팅 화면에서 「연결이 느립니다 · 다시 시도」, 알약을 거둔다
    const slow = after.find((x) => x.e === "status" && x.v.includes("연결이 느립니다"))
    expect(slow, msg).toBeTruthy()
    expect(slow!.path, msg).toBe("/chat")
    expect(slow!.t - at, msg).toBeGreaterThanOrEqual(7_500)
    expect(after.some((x) => x.e === "stalled" && x.v === "true" && x.path === "/chat"), msg).toBe(true)
    // 새로 연 문서가 /tasks 로 떴다
    expect(after.some((x) => x.e === "load" && x.path === "/tasks"), msg).toBe(true)
    await expect
      .poll(() => reports.some((r) => r.kind === "nav_failed" && /Failed to fetch RSC payload/.test(r.message ?? "")))
      .toBe(true)
  })

  // 지키는 것: 응답이 늦을 때 지금 탭을 다시 누르면 바로 원래대로 — 「연결이 느립니다」 도 새로 열기도 없다
  test("지금 탭을 누르면 바로 원래대로", async ({ page }) => {
    await recordErrors(page)
    // /tasks 의 RSC 는 응답하지 않는다(느린 망) — 라우터는 멈추지 않고 기다린다
    let documents = 0
    await page.route(
      (u) => u.pathname === "/tasks",
      async (route) => {
        if (route.request().isNavigationRequest()) documents++
        // 응답 없이 둔다
      }
    )
    await login(page, "팀장")
    await settled(page)
    await nav(page).getByRole("link", { name: "업무" }).click({ noWaitAfter: true })
    await expect(nav(page).getByRole("link", { name: "업무" })).toHaveAttribute("aria-current", "page")
    await nav(page).getByRole("link", { name: "채팅" }).click({ noWaitAfter: true })
    await expect(nav(page).getByRole("link", { name: "채팅" })).toHaveAttribute("aria-current", "page")
    await page.waitForTimeout(11_000)
    expect(new URL(page.url()).pathname).toBe("/chat")
    await expect(page.getByRole("status").filter({ hasText: "연결이 느립니다" })).toHaveCount(0)
    expect(documents).toBe(0)
  })

  // 지키는 것: 오프라인이 되면 띠가 보이고, 다시 연결되면 사라진다
  test("오프라인 띠", async ({ page, context }) => {
    await login(page, "팀장")
    // 화면의 JS 조각을 다 받기 전에 끊으면 ChunkLoadError 로 전역 오류 화면이 된다(이 시험이 보려는 것이 아니다)
    await settled(page)
    await context.setOffline(true)
    await expect(page.getByRole("status").filter({ hasText: "오프라인" })).toBeVisible()
    await context.setOffline(false)
    await expect(page.getByRole("status").filter({ hasText: "오프라인" })).toHaveCount(0)
  })
})
