import "dotenv/config"
import { test, expect, type Page } from "@playwright/test"
import { hashSync } from "bcryptjs"
import { randomUUID } from "node:crypto"
import { prisma } from "../../lib/db"

// 온보딩은 스포트라이트 하나다(2026-10-29) — 간편 로그인 → 옴니스 시연 둘 → 업무 · 캘린더 · 아카이브 탭.
// mydocs/plans/2026-10-29-onboarding-tab-tour.md
const STOPS = [
  "social",
  "create-task",
  "write-doc",
  "tasks",
  "calendar",
  "archive",
] as const
const ROUTES: Partial<Record<(typeof STOPS)[number], string>> = {
  "create-task": "/chat/new",
  "write-doc": "/chat/new",
  tasks: "/tasks",
  calendar: "/calendar",
  archive: "/omnis",
}
const NAV_TARGET: Partial<Record<(typeof STOPS)[number], string>> = {
  tasks: "tasks",
  calendar: "calendar",
  archive: "resources",
}

test.describe("onboarding", () => {
  test.skip(
    !!process.env.BASE_URL &&
      !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(process.env.BASE_URL),
    "격리된 로컬 계정으로 검증"
  )
  let id: string
  let name: string
  let password: string

  test.beforeEach(async () => {
    const target = new URL(process.env.DATABASE_URL!)
    if (!["localhost", "127.0.0.1", "::1"].includes(target.hostname))
      throw new Error("온보딩 E2E는 로컬 DB만 사용합니다.")
    name = `onboarding-${randomUUID().slice(0, 8)}`
    password = randomUUID()
    const user = await prisma.user.create({
      data: { name, passwordHash: hashSync(password, 4) },
    })
    id = user.id
  })
  test.afterEach(async () => {
    if (id) await prisma.user.delete({ where: { id } })
  })
  test.afterAll(async () => {
    await prisma.$disconnect()
  })

  async function login(page: Page) {
    await page.goto("/login")
    await page.getByRole("textbox", { name: "이름", exact: true }).fill(name)
    await page
      .getByRole("textbox", { name: "비밀번호", exact: true })
      .fill(password)
    await page.getByRole("button", { name: "로그인", exact: true }).click()
    await page.waitForURL("**/chat")
  }
  const tour = (page: Page) =>
    page.getByRole("dialog", { name: "Omnis 화면 안내" })
  async function atStop(page: Page, stop: (typeof STOPS)[number]) {
    await expect(page.locator("[data-tour-stop]")).toHaveAttribute(
      "data-tour-stop",
      stop
    )
    const route = ROUTES[stop]
    if (route) await page.waitForURL(`**${route}`)
  }
  const next = (page: Page) => page.locator(".spotlight-next")
  async function completed() {
    return (
      (await prisma.user.findUniqueOrThrow({ where: { id } }))
        .onboardingCompletedAt !== null
    )
  }

  /** 탭 장면 — 보이는 nav 탭에 강조가 꼭 맞고, 설명창은 그 강조와 겹치지 않으며 화면 안에 있다 */
  async function spotlightFitsTab(page: Page, target: string) {
    await expect
      .poll(
        () =>
          page.evaluate((name) => {
            const node = [
              ...document.querySelectorAll(`[data-onboarding="${name}"]`),
            ].find((item) => {
              const r = item.getBoundingClientRect()
              return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight
            })
            const hole = document.querySelector(".spotlight-shade > rect[stroke]")
            const card = document.querySelector(".spotlight-card")
            if (!node || !hole || !card) return "대상 · 강조 · 설명창 중 없는 것이 있다"
            const t = node.getBoundingClientRect(),
              h = hole.getBoundingClientRect(),
              c = card.getBoundingClientRect()
            const tight =
              Math.abs(t.left - h.left) <= 8 &&
              Math.abs(t.top - h.top) <= 8 &&
              Math.abs(t.right - h.right) <= 8 &&
              Math.abs(t.bottom - h.bottom) <= 8
            const separate =
              c.right <= h.left ||
              c.left >= h.right ||
              c.bottom <= h.top ||
              c.top >= h.bottom
            const inside =
              c.top >= 0 &&
              c.bottom <= innerHeight &&
              c.left >= 0 &&
              c.right <= innerWidth
            const body = !!document.querySelector("[data-spotlight-body]")
            return tight && separate && inside && body
              ? "ok"
              : JSON.stringify({ tight, separate, inside, body })
          }, target),
        { message: `탭 강조와 설명 위치: ${target}` }
      )
      .toBe("ok")
  }

  /** 시연 장면 — 시연 층이 화면 안에 있고 설명창과 겹치지 않는다. 가로로 넘치지 않는다 */
  async function demoFits(page: Page) {
    await expect
      .poll(() =>
        page.evaluate(() => {
          const demo = document.querySelector("[data-tour-demo]")
          const card = document.querySelector(".spotlight-card")
          if (!demo || !card) return "시연 층 · 설명창 중 없는 것이 있다"
          const d = demo.getBoundingClientRect(),
            c = card.getBoundingClientRect()
          const inside =
            d.left >= 0 && d.top >= 0 && d.right <= innerWidth && d.bottom <= innerHeight
          const separate =
            c.right <= d.left || c.left >= d.right || c.bottom <= d.top || c.top >= d.bottom
          const noScroll = document.documentElement.scrollWidth <= innerWidth
          return inside && separate && noScroll
            ? "ok"
            : JSON.stringify({ inside, separate, noScroll })
        })
      )
      .toBe("ok")
  }

  test("장면 순서대로 화면을 옮겨 다니며 비추고, 끝나면 시작한 화면으로 돌아온다", async ({
    page,
  }) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.clock.install()
    await login(page)
    await atStop(page, "social")
    // 고르는 장면이라 저절로 넘어가지 않는다
    await page.clock.runFor(10_000)
    await atStop(page, "social")
    await expect(page.getByText(`OMNIS GUIDE · 1 / ${STOPS.length}`)).toBeVisible()
    await expect(page.locator(".spotlight-playback")).toHaveCount(0)
    await expect(page.getByRole("button", { name: "이전 안내" })).toBeDisabled()
    await next(page).click()
    await atStop(page, "create-task")
    await page.clock.runFor(1500)
    await demoFits(page)
    // 이전 · 다음
    await page.getByRole("button", { name: "이전 안내" }).click()
    await atStop(page, "social")
    await next(page).click()
    await atStop(page, "create-task")
    await next(page).click()
    await atStop(page, "write-doc")
    await next(page).click()
    await atStop(page, "tasks")
    await page.clock.runFor(1500)
    await spotlightFitsTab(page, "tasks")
    // 탭 장면은 읽을 시간이 지나면 저절로 넘어간다
    await page.clock.runFor(7500)
    await atStop(page, "calendar")
    await page.clock.runFor(1500)
    await spotlightFitsTab(page, "calendar")
    await next(page).click()
    await atStop(page, "archive")
    await page.clock.runFor(1500)
    await spotlightFitsTab(page, "resources")
    await expect(page.locator(".spotlight-card")).toContainText(
      "지식 카드 · 시놀로지 · 지식재산권 · 고객·견적"
    )
    await expect(page.locator(".spotlight-card")).toContainText(
      "안내는 마이에서 다시 볼 수 있어요"
    )
    await page.screenshot({
      animations: "disabled",
      path: "/tmp/omnis-onboarding-archive.png",
    })
    await page.getByRole("button", { name: "안내 마치기", exact: true }).click()
    await expect(page.locator(".omnis-tour-surface")).toHaveCount(0)
    await page.waitForURL("**/chat")
    await expect.poll(completed).toBe(true)
    expect(errors).toEqual([])
  })

  test("옴니스 시연은 실제 컴포넌트로 대본을 재생하고 API 를 부르거나 쓰지 않는다", async ({
    page,
  }) => {
    await page.clock.install()
    await login(page)
    await atStop(page, "social")
    const calls: string[] = []
    page.on("request", (request) => {
      const url = new URL(request.url())
      if (
        url.pathname.includes("/api/agent") ||
        (request.method() !== "GET" && url.pathname.includes("/api/"))
      )
        calls.push(`${request.method()} ${url.pathname}`)
    })
    await next(page).click()
    await atStop(page, "create-task")
    const demo = page.locator('[data-tour-demo="create-task"]')
    await page.clock.runFor(1500)
    await expect(demo).toBeVisible()
    // 입력칸에 한 글자씩
    await page.clock.runFor(1800)
    await expect(demo.locator("textarea")).toHaveValue(/^다음 주 금요일까지/)
    await expect(demo.locator("textarea")).not.toHaveValue(/사원2$/)
    // 보냄 → 내 말풍선 · 도구 줄
    await page.clock.runFor(2500)
    await expect(demo.locator("textarea")).toHaveValue("")
    await expect(demo).toContainText("가벽 블라인드 설치 견적 받아줘")
    await expect(demo.locator("[data-agent-live]")).toBeVisible()
    // 확인 카드 → 눌린 표시 → 실행됨
    await page.clock.runFor(2000)
    await expect(demo.locator('[data-agent-card="PENDING"]')).toBeVisible()
    await expect(demo.locator("[data-tool-trail]").first()).toContainText("도구 2개")
    await page.clock.runFor(5500)
    await expect(demo.locator('[data-agent-card="EXECUTED"]')).toBeVisible()
    await expect(demo).toContainText("업무를 만들었어요")
    // 시연 층은 inert — 확인 카드 버튼 · 입력칸을 눌러도 아무 일이 없다. 진짜 입력칸은 비어 있다
    await expect(demo).toHaveAttribute("inert", "")
    await expect(
      page.locator('[data-onboarding="omnis-room"] textarea')
    ).toHaveValue("")
    // 대본이 끝나면 저절로 지식 카드 시연으로
    await page.clock.runFor(4500)
    await atStop(page, "write-doc")
    const doc = page.locator('[data-tour-demo="write-doc"]')
    await page.clock.runFor(1500)
    await expect(doc).toBeVisible()
    await page.clock.runFor(7500)
    await expect(doc.locator("[data-agent-live]")).toContainText("진행 상황")
    await page.clock.runFor(4000)
    await expect(doc.locator('[data-agent-card="PENDING"]')).toContainText("새 지식 카드")
    await page.clock.runFor(3000)
    await expect(doc.locator('[data-agent-card="EXECUTED"]')).toBeVisible()
    await page.clock.runFor(5000)
    await atStop(page, "tasks")
    expect(calls).toEqual([])
    // DB 도 그대로 — 옴니스 방도 업무도 생기지 않았다
    expect(
      await prisma.chatRoom.count({
        where: { kind: "OMNIS_DM", members: { some: { userId: id } } },
      })
    ).toBe(0)
    expect(
      await prisma.task.count({ where: { instructorId: id } })
    ).toBe(0)
  })

  test("폰 폭 · 다크 · 모션 감소에서 시연은 끝 장면을 바로 보이고 탭 장면은 하단 nav 를 비춘다", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" })
    await page.addInitScript(() => localStorage.setItem("theme", "dark"))
    await page.clock.install()
    await login(page)
    await atStop(page, "social")
    await page.clock.runFor(1500)
    expect(
      await page.locator(".spotlight-card").evaluate((node) => {
        const r = node.getBoundingClientRect()
        return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth
      })
    ).toBe(true)
    await next(page).click()
    await atStop(page, "create-task")
    await page.clock.runFor(1500)
    await demoFits(page)
    // 타이핑 · 스트리밍 없이 끝 장면
    const demo = page.locator('[data-tour-demo="create-task"]')
    await expect(demo.locator('[data-agent-card="EXECUTED"]')).toBeVisible()
    await expect(demo.locator("textarea")).toHaveValue("")
    await page.screenshot({
      animations: "disabled",
      path: "/tmp/omnis-onboarding-mobile-demo.png",
    })
    await next(page).click()
    await atStop(page, "write-doc")
    await page.clock.runFor(1500)
    await demoFits(page)
    await expect(
      page.locator('[data-tour-demo="write-doc"] [data-agent-card="EXECUTED"]')
    ).toBeVisible()
    await next(page).click()
    await atStop(page, "tasks")
    await page.clock.runFor(1500)
    await spotlightFitsTab(page, NAV_TARGET.tasks!)
    await page.screenshot({
      animations: "disabled",
      path: "/tmp/omnis-onboarding-mobile-spotlight.png",
    })
    await page.getByRole("button", { name: "안내 건너뛰기" }).click()
    await expect(page.locator(".omnis-tour-surface")).toHaveCount(0)
    await expect.poll(completed).toBe(true)
  })

  test("간편 로그인 장면 — 「나중에」 로 넘어가고, 연결하고 돌아오면 다음 장면부터 잇는다", async ({
    page,
  }) => {
    await login(page)
    await atStop(page, "social")
    // 켜진 제공자가 없으면(로컬 · CI) 버튼 대신 마이 안내, 있으면 연결 버튼
    const providers = Object.keys(
      await page.request.get("/api/auth/providers").then((r) => r.json())
    ).filter((p) => p === "google" || p === "kakao")
    if (providers.length === 0)
      await expect(
        page.getByText("마이의 「소셜 로그인 연결」에서 언제든 연결할 수 있어요.")
      ).toBeVisible()
    else
      await expect(
        page.getByRole("button", { name: /연결하기$/ }).first()
      ).toBeVisible()
    await expect(next(page)).toHaveText("나중에")
    await next(page).click()
    await atStop(page, "create-task")

    // 제공자 화면에서 돌아온 것처럼 — 나가기 전에 적어 두는 기록을 넣고 다시 연다
    await page.goto("/settings")
    await page.evaluate(() =>
      sessionStorage.setItem(
        "omnis-tour-resume",
        JSON.stringify({ stop: 3, from: "/settings", at: Date.now() })
      )
    )
    await page.reload()
    await atStop(page, "tasks")
    // 한 번만 잇는다 — 다시 열면 처음부터
    await page.reload()
    await atStop(page, "social")

    // 켜진 제공자가 있으면 연결 버튼을 그린다(제공자 목록만 바꿔 본다 — 실제로 누르지 않는다)
    await page.route("**/api/auth/providers", (route) =>
      route.fulfill({
        json: {
          credentials: { id: "credentials" },
          google: { id: "google" },
          kakao: { id: "kakao" },
        },
      })
    )
    await page.reload()
    await atStop(page, "social")
    await expect(
      page.getByRole("button", { name: "Google 연결하기" })
    ).toBeVisible()
    await expect(page.getByRole("button", { name: "카카오 연결하기" })).toBeVisible()
  })

  test("계정 저장·새 브라우저·다른 계정·다시 보기·MCP 주소 복사", async ({
    page,
    browser,
  }) => {
    await login(page)
    await atStop(page, "social")
    await page.getByRole("button", { name: "안내 건너뛰기" }).click()
    await expect.poll(completed).toBe(true)
    await page.reload()
    await expect(page.getByRole("link", { name: /^마이/ }).first()).toBeVisible()
    await expect(page.locator(".omnis-tour-surface")).toHaveCount(0)
    const other = await browser.newContext()
    const otherPage = await other.newPage()
    await login(otherPage)
    await expect(otherPage.locator(".omnis-tour-surface")).toHaveCount(0)
    await other.close()
    await page.goto("/settings")
    await page.getByRole("button", { name: /Omnis MCP 등록/ }).click()
    const input = page.getByRole("textbox", { name: "MCP 서버 주소" })
    await expect(input).toHaveValue(/\/api\/ip-mcp$/)
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
    await page.getByRole("button", { name: "서버 주소 복사" }).click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      await input.inputValue()
    )
    await page.getByRole("button", { name: "닫기", exact: true }).click()
    // 다시 보기는 스포트라이트 첫 장면부터, 끝나면 마이로 돌아온다
    await page.getByRole("button", { name: "온보딩 튜토리얼 다시 보기" }).click()
    await atStop(page, "social")
    await next(page).click()
    await atStop(page, "create-task")
    await page.keyboard.press("Escape")
    await expect(page.locator(".omnis-tour-surface")).toHaveCount(0)
    await page.waitForURL("**/settings")
    const second = await prisma.user.create({
      data: { name: `${name}-other`, passwordHash: hashSync(password, 4) },
    })
    try {
      const context = await browser.newContext()
      const secondPage = await context.newPage()
      const firstName = name
      name = second.name
      await login(secondPage)
      name = firstName
      await atStop(secondPage, "social")
      await context.close()
    } finally {
      await prisma.user.delete({ where: { id: second.id } })
    }
  })

  test("잘못된 요청·타 계정 쓰기·비활성 계정 거부, 반복 완료 멱등성", async ({
    page,
    request,
  }) => {
    expect((await request.get("/api/onboarding")).status()).toBe(401)
    expect(
      (
        await request.post("/api/onboarding", { data: { phase: "complete" } })
      ).status()
    ).toBe(401)
    await login(page)
    for (const data of [
      { phase: "wrong" },
      { phase: "complete", userId: "someone-else" },
      { phase: "complete", onboardingCompletedAt: null },
    ]) {
      expect(
        (await page.request.post("/api/onboarding", { data })).status()
      ).toBe(400)
    }
    expect(
      (
        await page.request.post("/api/onboarding", {
          data: { phase: "complete" },
          headers: { origin: "https://example.invalid" },
        })
      ).status()
    ).toBe(403)
    await page.request.post("/api/onboarding", { data: { phase: "complete" } })
    const before = await page.request
      .get("/api/onboarding")
      .then((r) => r.json())
    await page.request.post("/api/onboarding", { data: { phase: "complete" } })
    // 옛 클라이언트가 보내던 phase: "video" 도 받는 쪽은 그대로 받는다 — 이미 마친 기록은 바뀌지 않는다
    await page.request.post("/api/onboarding", { data: { phase: "video" } })
    expect(
      await page.request.get("/api/onboarding").then((r) => r.json())
    ).toEqual(before)
    await prisma.user.update({ where: { id }, data: { isActive: false } })
    expect((await page.request.get("/api/onboarding")).status()).toBe(401)
    expect(
      (
        await page.request.post("/api/onboarding", {
          data: { phase: "complete" },
        })
      ).status()
    ).toBe(401)
  })

  test("영상만 본 사람도 새 안내를 처음부터 보고, 저장에 실패해도 서비스는 쓸 수 있다", async ({
    page,
  }) => {
    await prisma.user.update({
      where: { id },
      data: { onboardingVideoSeenAt: new Date() },
    })
    await login(page)
    await atStop(page, "social")
    await page.route("**/api/onboarding", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 500, body: "failed" })
        : route.continue()
    )
    await page.getByRole("button", { name: "안내 건너뛰기" }).click()
    await expect(page.locator(".omnis-tour-surface")).toHaveCount(0)
    await expect(
      page.getByText("안내 이력을 저장하지 못했어요.", { exact: false })
    ).toBeVisible()
    await page.unroute("**/api/onboarding")
    await page.getByRole("button", { name: "다시 저장", exact: true }).click()
    await expect.poll(completed).toBe(true)
  })

  test("숨은 탭에서는 멈추고, 일시정지 · Esc 종료 · 포커스 가두기", async ({
    page,
  }) => {
    await page.clock.install()
    await login(page)
    await atStop(page, "social")
    await next(page).click()
    await atStop(page, "create-task")
    await next(page).click()
    await atStop(page, "write-doc")
    await next(page).click()
    await atStop(page, "tasks")
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      })
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await page.clock.runFor(15_000)
    await atStop(page, "tasks")
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: false,
      })
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await page.getByRole("button", { name: "Ⅱ 일시정지" }).click()
    await page.clock.runFor(15_000)
    await atStop(page, "tasks")
    await page.getByRole("button", { name: "▷ 재생" }).click()
    await page.clock.runFor(8_500)
    await atStop(page, "calendar")
    // 포커스는 안내 안에서만 돈다
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab")
      expect(
        await page.evaluate(
          () => !!document.activeElement?.closest(".omnis-tour-surface")
        )
      ).toBe(true)
    }
    await page.keyboard.press("Escape")
    await expect(tour(page)).toHaveCount(0)
    await page.waitForURL("**/chat")
    await expect.poll(completed).toBe(true)
  })
})
