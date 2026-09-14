import "dotenv/config"
import { test, expect, type Page } from "@playwright/test"
import { hashSync } from "bcryptjs"
import { randomUUID } from "node:crypto"
import { prisma } from "../../lib/db"

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
    await page.waitForURL("**/dashboard")
  }
  async function skipVideo(page: Page) {
    await page.getByRole("button", { name: "건너뛰기", exact: true }).click()
    await expect(
      page.getByRole("dialog", { name: "Omnis 화면 안내" })
    ).toBeVisible()
  }
  async function finish(page: Page) {
    await skipVideo(page)
    await page.getByRole("button", { name: "안내 건너뛰기" }).click()
    await expect
      .poll(
        async () =>
          (await prisma.user.findUniqueOrThrow({ where: { id } }))
            .onboardingCompletedAt !== null
      )
      .toBe(true)
  }

  test("8장면 자동 재생·일시정지·최종 CTA·스포트라이트", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.clock.install()
    await login(page)
    const stage = page.locator(".intro-stage")
    await expect(stage).toHaveAttribute("data-step", "1")
    await page.getByRole("heading").filter({ hasText: "안녕하세요" }).click()
    await expect(stage).toHaveAttribute("data-step", "1")
    await page.getByRole("button", { name: "일시정지", exact: true }).click()
    await page.clock.fastForward(5000)
    await expect(stage).toHaveAttribute("data-step", "1")
    await page.getByRole("button", { name: "재생", exact: true }).click()
    const durations = [4100, 5100, 6100, 12100, 10100, 9100, 7100]
    for (let index = 0; index < durations.length; index++) {
      await page.clock.fastForward(durations[index])
      await expect(stage).toHaveAttribute("data-step", String(index + 2))
      if (index === 1) {
        await page.clock.fastForward(6000)
        await page.waitForTimeout(1200)
        await page.screenshot({
          animations: "disabled",
          path: "/tmp/omnis-onboarding-workflow.png",
        })
        await expect(
          page.locator('.intro-real-task [data-slot="badge"]')
        ).toHaveText("할 일")
      }
    }
    await page.clock.fastForward(15000)
    await expect(stage).toHaveAttribute("data-step", "8")
    await page.getByRole("button", { name: "업무 시작하기" }).click()
    const stops = [
      "tasks",
      "chat-trigger",
      "conversation",
      "ai",
      "resources",
      "profile",
      "mcp",
      "replay",
    ]
    for (const stop of stops) {
      await expect(page.locator("[data-tour-stop]")).toHaveAttribute(
        "data-tour-stop",
        stop
      )
      await page.clock.fastForward(1300)
      await expect(page.locator(".spotlight-shade mask rect")).toHaveCount(2)
      if (stop === "mcp") {
        await page.waitForTimeout(1200)
        await page.screenshot({
          animations: "disabled",
          path: "/tmp/omnis-onboarding-spotlight.png",
        })
      }
      await page.clock.fastForward(7100)
    }
    await expect(
      page.getByRole("dialog", { name: "Omnis 화면 안내" })
    ).toHaveCount(0)
    await expect
      .poll(
        async () =>
          (await prisma.user.findUniqueOrThrow({ where: { id } }))
            .onboardingCompletedAt !== null
      )
      .toBe(true)
    expect(errors).toEqual([])
  })

  test("계정 저장·새 브라우저·다른 계정·재생·MCP 주소 복사", async ({
    page,
    browser,
  }) => {
    await login(page)
    await finish(page)
    await page.reload()
    await expect(
      page.getByRole("button", { name: "프로필 메뉴" })
    ).toBeVisible()
    await expect(page.locator(".omnis-tour-surface")).toHaveCount(0)
    const other = await browser.newContext()
    const otherPage = await other.newPage()
    await login(otherPage)
    await expect(otherPage.locator(".omnis-tour-surface")).toHaveCount(0)
    await other.close()
    await page.getByRole("button", { name: "프로필 메뉴" }).click()
    await page.getByRole("menuitem", { name: "Omnis MCP 등록" }).click()
    const input = page.getByRole("textbox", { name: "MCP 서버 주소" })
    await expect(input).toHaveValue(/\/api\/ip-mcp$/)
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
    await page.getByRole("button", { name: "서버 주소 복사" }).click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      await input.inputValue()
    )
    await page.getByRole("button", { name: "닫기", exact: true }).click()
    await page.getByRole("button", { name: "프로필 메뉴" }).click()
    await page.getByRole("menuitem", { name: "온보딩 튜토리얼" }).click()
    await expect(page.locator(".intro-stage")).toHaveAttribute("data-step", "1")
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
      await expect(secondPage.locator(".intro-stage")).toHaveAttribute(
        "data-step",
        "1"
      )
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

  test("영상만 마치면 스포트라이트부터 재개, 실패해도 서비스 이용 가능", async ({
    page,
  }) => {
    await login(page)
    await skipVideo(page)
    await expect
      .poll(
        async () =>
          (await prisma.user.findUniqueOrThrow({ where: { id } }))
            .onboardingVideoSeenAt !== null
      )
      .toBe(true)
    await page.reload()
    await expect(
      page.getByRole("dialog", { name: "Omnis 화면 안내" })
    ).toBeVisible()
    await expect(page.locator(".intro-stage")).toHaveCount(0)
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
    await expect
      .poll(
        async () =>
          (await prisma.user.findUniqueOrThrow({ where: { id } }))
            .onboardingCompletedAt !== null
      )
      .toBe(true)
  })

  test("비활성 탭에서 재생 정지, 키보드 종료, 작성 중인 AI 질문 보존", async ({
    page,
  }) => {
    await page.clock.install()
    await login(page)
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      })
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await page.clock.fastForward(10000)
    await expect(page.locator(".intro-stage")).toHaveAttribute("data-step", "1")
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: false,
      })
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await page.clock.fastForward(4200)
    await expect(page.locator(".intro-stage")).toHaveAttribute("data-step", "2")
    await page.keyboard.press("Escape")
    await expect(
      page.getByRole("dialog", { name: "Omnis 화면 안내" })
    ).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.locator(".omnis-tour-surface")).toHaveCount(0)
    await page
      .getByRole("button", { name: "Omnis AI 에게 질문", exact: true })
      .click()
    const input = page.getByRole("textbox", { name: "옴니스에게 보낼 질문" })
    await input.fill("아직 전송하지 않은 질문입니다")
    const url = page.url()
    await page.getByRole("button", { name: "프로필 메뉴" }).click()
    await page.getByRole("menuitem", { name: "온보딩 튜토리얼" }).click()
    await skipVideo(page)
    for (let index = 0; index < 2; index++) {
      await page.clock.fastForward(1300)
      await page.clock.fastForward(7100)
    }
    await expect(page.locator("[data-tour-stop]")).toHaveAttribute(
      "data-tour-stop",
      "conversation"
    )
    await page.getByRole("button", { name: "안내 건너뛰기" }).click()
    await expect(input).toHaveValue("아직 전송하지 않은 질문입니다")
    expect(page.url()).toBe(url)
    await expect(input).toBeVisible()
  })

  test("모바일·다크·모션 감소에서 메뉴 안내와 종료 버튼 도달", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" })
    await page.addInitScript(() => localStorage.setItem("theme", "dark"))
    await page.clock.install()
    await login(page)
    await expect(page.locator(".intro-stage")).toHaveAttribute("data-step", "1")
    await page.waitForTimeout(1200)
    await page.screenshot({
      animations: "disabled",
      path: "/tmp/omnis-onboarding-mobile.png",
    })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true)
    await skipVideo(page)
    await page.clock.fastForward(1300)
    await expect(page.locator(".spotlight-shade mask rect")).toHaveCount(2)
    expect(
      await page
        .locator(".spotlight-card")
        .evaluate((node) => node.getBoundingClientRect().height)
    ).toBeLessThan(350)
    for (let index = 0; index < 6; index++) {
      await page.clock.fastForward(1300)
      await page.clock.fastForward(7100)
    }
    await page.clock.fastForward(1300)
    await expect(page.locator("[data-tour-stop]")).toHaveAttribute(
      "data-tour-stop",
      "mcp"
    )
    await expect(page.locator(".spotlight-shade mask rect")).toHaveCount(2)
    await page.waitForTimeout(1200)
    await page.screenshot({
      animations: "disabled",
      path: "/tmp/omnis-onboarding-mobile-spotlight.png",
    })
    await page.getByRole("button", { name: "안내 건너뛰기" }).click()
    await expect(page.locator(".omnis-tour-surface")).toHaveCount(0)
  })
})
