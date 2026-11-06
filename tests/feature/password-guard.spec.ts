/**
 * 비밀번호 로그인 시도 제한(계정 · IP), 관리자가 정한 비밀번호의 변경 요구, 본인 변경.
 * 각 시험은 자기 IP(x-forwarded-for)를 써서 다른 시험의 127.0.0.1 한도를 건드리지 않는다.
 */
import { hashSync } from "bcryptjs"
import { expect, test, type Browser, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { LOGIN_ENTITY, LOGIN_LIMITS, accountKey, ipKey } from "../../lib/login-guard"
import { PASSWORD_ENTITY } from "../../lib/password-state"
import { DEMO_PASSWORD } from "./_setup"

const stamp = Date.now()
const LOCK_USER = `잠금시험${stamp}`
const RESET_USER = `초기화시험${stamp}`
const PASSWORD = `first pass ${stamp}`
const NEXT_PASSWORD = `second pass ${stamp}`
const ipFor = (n: number) => `203.0.113.${(stamp + n) % 250}`

async function contextFrom(browser: Browser, ip: string) {
  return browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip } })
}

async function submitLogin(page: Page, name: string, password: string) {
  await page.goto("/login")
  await page.getByRole("textbox", { name: "이름" }).fill(name)
  await page.getByRole("textbox", { name: "비밀번호" }).fill(password)
  await page.getByRole("button", { name: "로그인", exact: true }).click()
}

test.describe("비밀번호 로그인 보호", () => {
  const prisma = new PrismaClient()
  const userIds: string[] = []
  const ips = [ipFor(1), ipFor(2), ipFor(3)]

  test.beforeAll(async () => {
    for (const name of [LOCK_USER, RESET_USER]) {
      const u = await prisma.user.create({ data: { name, passwordHash: hashSync(PASSWORD, 10), role: "MEMBER", onboardingCompletedAt: new Date() } })
      userIds.push(u.id)
    }
    await prisma.activityLog.create({
      data: { userId: userIds[1], entity: PASSWORD_ENTITY, entityId: userIds[1], action: "reset", title: "비밀번호 초기화" },
    })
  })

  test.afterAll(async () => {
    await prisma.activityLog.deleteMany({
      where: {
        OR: [
          { userId: { in: userIds } },
          { entity: LOGIN_ENTITY, entityId: { in: [accountKey(LOCK_USER), accountKey(RESET_USER), accountKey("사원3"), ...ips.map(ipKey)] } },
        ],
      },
    })
    await prisma.user.deleteMany({ where: { id: { in: userIds } } })
    await prisma.$disconnect()
  })

  test("같은 계정을 계속 틀리면 맞는 비밀번호도 잠시 막힌다", async ({ browser }) => {
    const ctx = await contextFrom(browser, ips[0])
    const page = await ctx.newPage()
    for (let i = 0; i < LOGIN_LIMITS.account.max; i++) {
      await submitLogin(page, LOCK_USER, `wrong ${i}`)
      await expect(page.getByText("이름 또는 비밀번호가 올바르지 않습니다.")).toBeVisible()
    }
    await submitLogin(page, LOCK_USER, PASSWORD)
    await expect(page.getByText(/로그인 시도가 너무 많아/)).toBeVisible()
    await expect(page).toHaveURL(/\/login$/)
    await ctx.close()
  })

  test("한 IP 에서 실패가 한도를 넘으면 다른 계정도 막힌다", async ({ browser }) => {
    await prisma.activityLog.createMany({
      data: Array.from({ length: LOGIN_LIMITS.ip.max }, () => ({ entity: LOGIN_ENTITY, entityId: ipKey(ips[1]), action: "fail", title: "로그인 실패" })),
    })
    const ctx = await contextFrom(browser, ips[1])
    const page = await ctx.newPage()
    await submitLogin(page, "사원3", DEMO_PASSWORD)
    await expect(page.getByText(/로그인 시도가 너무 많아/)).toBeVisible()
    await ctx.close()

    // 다른 IP 에서는 그 계정이 그대로 들어간다
    const other = await contextFrom(browser, ips[2])
    const ok = await other.newPage()
    await submitLogin(ok, "사원3", DEMO_PASSWORD)
    await ok.waitForURL("**/chat", { timeout: 15_000 })
    await other.close()
  })

  test("관리자가 정한 비밀번호로 들어오면 막지 않고 바꾸라고 안내한다", async ({ browser }) => {
    const ctx = await contextFrom(browser, ips[2])
    const page = await ctx.newPage()
    await submitLogin(page, RESET_USER, PASSWORD)
    await page.waitForURL("**/chat", { timeout: 15_000 })
    const notice = page.getByRole("status", { name: "비밀번호 변경 안내" })
    await expect(notice).toBeVisible()

    // 「나중에」 로 닫고 다른 화면을 그대로 쓸 수 있다
    await notice.getByRole("button", { name: "나중에" }).click()
    await expect(notice).toBeHidden()
    await page.goto("/tasks")
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(notice).toBeHidden()

    // 변경 화면에서도 「나중에」 로 앱에 돌아갈 수 있다
    await page.goto("/account/password")
    await page.getByRole("link", { name: "나중에" }).click()
    await page.waitForURL("**/chat", { timeout: 15_000 })
    await page.goto("/account/password")

    // 지금 비밀번호가 틀리면 바뀌지 않는다
    const wrong = await page.request.post("/api/account/password", { data: { current: "not it at all", next: NEXT_PASSWORD } })
    expect(wrong.status()).toBe(400)

    await page.getByLabel("지금 비밀번호", { exact: true }).fill(PASSWORD)
    await page.getByLabel("새 비밀번호", { exact: true }).fill(NEXT_PASSWORD)
    await page.getByLabel("새 비밀번호 확인", { exact: true }).fill(NEXT_PASSWORD)
    await page.getByRole("button", { name: "비밀번호 바꾸기" }).click()
    await page.waitForURL("**/chat", { timeout: 15_000 })
    // 바꾼 뒤에는 새 탭에서도 안내가 뜨지 않는다
    const fresh = await ctx.newPage()
    await fresh.goto("/chat")
    await expect(fresh.getByRole("status", { name: "비밀번호 변경 안내" })).toHaveCount(0)
    await ctx.close()

    // 옛 비밀번호는 더 이상 안 되고 새 비밀번호는 된다
    const again = await contextFrom(browser, ips[2])
    const p2 = await again.newPage()
    await submitLogin(p2, RESET_USER, PASSWORD)
    await expect(p2.getByText("이름 또는 비밀번호가 올바르지 않습니다.")).toBeVisible()
    await submitLogin(p2, RESET_USER, NEXT_PASSWORD)
    await p2.waitForURL("**/chat", { timeout: 15_000 })
    await again.close()
  })

  for (const width of [1280, 390]) {
    test(`변경 화면의 세 칸 모두 눈 아이콘으로 글자를 보이고 숨긴다 (${width}px)`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width, height: 844 }, extraHTTPHeaders: { "x-forwarded-for": ips[2] } })
      const page = await ctx.newPage()
      await submitLogin(page, "사원3", DEMO_PASSWORD)
      await page.waitForURL("**/chat", { timeout: 15_000 })
      await page.goto("/account/password")
      for (const label of ["지금 비밀번호", "새 비밀번호", "새 비밀번호 확인"]) {
        const input = page.getByLabel(label, { exact: true })
        const toggle = page.getByRole("button", { name: `${label} 보기` })
        await input.fill("sample text")
        await expect(input).toHaveAttribute("type", "password")
        await expect(toggle).toBeVisible()
        // 아이콘이 칸 안에 들어가 있다(좁은 화면에서 밀려나지 않는다)
        const [box, btn] = [await input.boundingBox(), await toggle.boundingBox()]
        expect(btn!.x + btn!.width).toBeLessThanOrEqual(box!.x + box!.width + 1)
        await toggle.click()
        await expect(input).toHaveAttribute("type", "text")
        await page.getByRole("button", { name: `${label} 숨기기` }).click()
        await expect(input).toHaveAttribute("type", "password")
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await ctx.close()
    })
  }

  test("인증 기록은 활동 API 에 나오지 않는다", async ({ browser }) => {
    const ctx = await contextFrom(browser, ips[2])
    const page = await ctx.newPage()
    await submitLogin(page, "사원3", DEMO_PASSWORD)
    await page.waitForURL("**/chat", { timeout: 15_000 })
    const all = (await (await page.request.get("/api/activity?take=50")).json()) as { logs: { entity: string }[] }
    expect(all.logs.some((l) => l.entity.startsWith("auth."))).toBe(false)
    const direct = (await (await page.request.get(`/api/activity?entity=${LOGIN_ENTITY}`)).json()) as { logs: unknown[] }
    expect(direct.logs).toHaveLength(0)
    await ctx.close()
  })
})
