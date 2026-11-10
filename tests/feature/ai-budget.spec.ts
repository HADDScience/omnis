/**
 * AI 비용 상한 — 관리자 화면에서 바꾸면 바로 쓴다 · 구성원은 못 바꾼다 · 한도 도달 안내에서 관리자가 그 자리에서 올린다.
 * 계획: mydocs/plans/2026-11-10-ai-budget.md
 *
 *   pnpm run test:e2e:local tests/feature/ai-budget.spec.ts
 *
 * 에이전트는 모델 키가 있어야 돌아서, 한도 도달 응답(429 + budget)만 흉내 낸다. 올리기는 실제 API 를 부른다.
 * 격리된 시험 DB(E2E_ISOLATED)면 사용 기록을 넣어 표를 채운다. AI_BUDGET_SHOTS 에 절대 경로를 주면 화면을 남긴다.
 */
import path from "node:path"
import { expect, test, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { quickLogin } from "./_setup"

const shots = process.env.AI_BUDGET_SHOTS
const box = (page: Page) => page.locator("[data-composer-pill] textarea").first()
const hydrated = (page: Page) =>
  expect.poll(() => box(page).evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))), { timeout: 30_000 }).toBe(true)

type Budget = { userDailyKrw: number; monthlyKrw: number; users: Record<string, number>; recipients: string[] }
let original: Budget | null = null

test.describe.configure({ mode: "serial" })

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage()
  await quickLogin(page, "팀장")
  original = (await (await page.request.get("/api/ai-budget")).json()) as Budget
  if (process.env.E2E_ISOLATED === "true") {
    // 표를 채울 사용 기록 — 이번 달 · 오늘. 데모 계정만
    const prisma = new PrismaClient()
    const users = await prisma.user.findMany({ where: { name: { in: ["팀장", "사원1", "사원2"] } }, select: { id: true, name: true } })
    const now = Date.now()
    await prisma.aiUsage.createMany({
      data: users.flatMap((u, i) => [0, 1, 2].map((d) => ({
        vendor: "google", model: "gemini-3.6-flash", feature: d === 0 ? "agent" : "rebuildTask",
        inputTokens: 1000, outputTokens: 500, costUsd: 0.1 * (i + 1), costKrw: 140 * (i + 1) + d * 30,
        userId: u.id, createdAt: new Date(now - d * 86_400_000),
      }))),
    })
    await prisma.$disconnect()
  }
  await page.close()
})

test.afterAll(async ({ browser }) => {
  if (!original) return
  const page = await browser.newPage()
  await quickLogin(page, "팀장")
  await page.request.put("/api/ai-budget", { data: original })
  await page.close()
})

test("관리자 — 상한을 저장하면 다시 읽을 때 바로 그 값이다", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await quickLogin(page, "팀장")
  await page.goto("/settings/ai-budget")
  const form = page.locator("[data-ai-budget-form]")
  await expect(form).toBeVisible({ timeout: 30_000 })
  await form.getByLabel("1인 하루 상한(원)").fill("1500")
  await form.getByLabel("사원1 하루 상한").fill("3000")
  await form.getByRole("button", { name: "저장", exact: true }).click()
  await expect(page.getByText("저장했어요")).toBeVisible()
  const now = (await (await page.request.get("/api/ai-budget")).json()) as Budget
  expect(now.userDailyKrw).toBe(1500)
  expect(Object.values(now.users)).toContain(3000)
  await page.reload()
  await expect(page.locator("[data-ai-cost-usage]")).toBeVisible({ timeout: 30_000 })
  if (shots) await page.screenshot({ path: path.join(shots, "ai-budget-admin-pc.png"), fullPage: true })
})

test("구성원 — 관리 화면 · 저장 API 는 막히고, 사용량 탭에는 자기 사용만 보인다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await quickLogin(page, "사원1")
  await page.goto("/settings/ai-budget")
  await expect(page.getByText("관리자만 볼 수 있습니다")).toBeVisible({ timeout: 30_000 })
  expect((await page.request.put("/api/ai-budget", { data: { userDailyKrw: 99999, monthlyKrw: 99999, users: {}, recipients: [] } })).status()).toBe(403)
  expect((await page.request.post("/api/ai-budget/raise", { data: { kind: "monthly", toKrw: 999999 } })).status()).toBe(403)
  await page.goto("/settings?tab=usage")
  const usage = page.locator("[data-ai-cost-usage]")
  await expect(usage).toBeVisible({ timeout: 30_000 })
  await expect(usage.getByRole("meter", { name: "오늘 내 사용" })).toBeVisible()
  // 구성원은 남의 줄을 보지 않는다
  if (process.env.E2E_ISOLATED === "true") await expect(usage.locator("[data-ai-usage-person]")).toHaveCount(1)
  await expect(usage.getByText("상한 조정하기")).toHaveCount(0)
  if (shots) await page.screenshot({ path: path.join(shots, "ai-budget-usage-mobile.png"), fullPage: true })
})

test("한도 도달 — 안내가 입력창 위에 남고, 관리자는 한 번 더 확인해 그 자리에서 올린다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await quickLogin(page, "팀장")
  const me = (await (await page.request.get("/api/auth/session")).json()) as { user: { id: string } }
  const before = (await (await page.request.get("/api/ai-budget")).json()) as Budget
  const limit = before.users[me.user.id] ?? before.userDailyKrw
  const suggest = Math.max(Math.ceil((limit * 1.5) / 500) * 500, limit + 500)
  await page.route("**/api/agent/rooms**", async (route) => {
    if (route.request().method() !== "POST") return route.continue()
    return route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({
        error: `오늘 AI 사용 한도(${limit.toLocaleString("ko-KR")}원)에 도달했어요. 내일 0시에 다시 열려요. 아래에서 한도를 올릴 수 있어요.`,
        budget: { kind: "user_daily", limitKrw: limit, usedKrw: limit, canRaise: true, suggestKrw: suggest, userId: me.user.id },
      }),
    })
  })
  await page.goto("/chat/new")
  await box(page).waitFor({ timeout: 30_000 })
  await hydrated(page)
  await box(page).fill("이번 주 업무 정리해 줘")
  await box(page).press("Enter")
  const notice = page.locator("[data-agent-quota]")
  await expect(notice).toContainText("오늘 AI 사용 한도")
  // 끊지 않는다 — 쓴 글은 입력칸에 돌아온다
  await expect(box(page)).toHaveValue("이번 주 업무 정리해 줘")
  await notice.locator("[data-raise-budget]").click()
  await expect(notice).toContainText(`${suggest.toLocaleString("ko-KR")}원`)
  if (shots) await page.screenshot({ path: path.join(shots, "ai-budget-limit-mobile.png") })
  await notice.locator("[data-raise-budget-confirm]").click()
  await expect(page.locator("[data-agent-quota]")).toHaveCount(0)
  const after = (await (await page.request.get("/api/ai-budget")).json()) as Budget
  expect(after.users[me.user.id]).toBe(suggest)
  // 내리는 것은 올리기 단추로 못 한다
  expect((await page.request.post("/api/ai-budget/raise", { data: { kind: "user_daily", userId: me.user.id, toKrw: 100 } })).status()).toBe(400)
})
