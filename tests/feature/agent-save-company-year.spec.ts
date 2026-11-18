/**
 * 앱 AI(옴니스 대화방)로 연도별 재무 한 줄 더하기(#248 묶음 4) — 관리자만 되는 화면 일(company/years)이라 관리자 계정으로 본다.
 * save_company_year 가 확인 카드(새 줄 · 금액)를 띄우고, 확인하면 화면 API 와 같은 서버 함수(lib/company-ops.ts)로 줄이 생긴다.
 * 시험 모델(OMNIS_AGENT_FAKE=1)이 글 속 [[도구 {입력}]] 대로 도구를 부른다. 금액은 지어낸 것이다.
 */
import { expect, test, type Locator, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { quickLogin } from "./_setup"

const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")
// 시드에 없는 먼 연도 — 다른 시험 · 시드와 겹치지 않게
const YEAR = 2091

const box = (page: Page) => page.locator("[data-composer-pill] textarea").first()
const reactReady = (el: Locator) =>
  expect.poll(() => el.evaluate((n) => Object.keys(n).some((k) => k.startsWith("__reactProps"))), { timeout: 30_000 }).toBe(true)

test.use({ viewport: { width: 1280, height: 860 } })

test("앱 AI — 관리자가 연도별 재무를 더하면 확인 카드에 금액이 보이고, 확인하면 그 줄이 생긴다", async ({ page }) => {
  test.skip(!LOCAL_DB, "시험 DB 를 직접 쓰고 읽는다")
  test.setTimeout(120_000)
  const prisma = new PrismaClient()
  await prisma.companyYear.deleteMany({ where: { year: YEAR } })
  try {
    await page.addInitScript(() => {
      localStorage.setItem("omnis:nudge-off:install", "1")
      localStorage.setItem("omnis:nudge-off:push", "1")
    })
    await quickLogin(page, "팀장")
    await page.goto("/chat/new")
    await box(page).waitFor({ timeout: 30_000 })
    await reactReady(box(page))
    await box(page).fill(`${YEAR}년 계획 매출을 적어 줘 [[save_company_year ${JSON.stringify({ year: YEAR, basis: "PLANNED", revenue_krw: "123,000,000", headcount: "7" })}]]`)
    await box(page).press("Enter")

    const card = page.locator("[data-agent-card=PENDING]")
    await expect(card).toBeVisible({ timeout: 60_000 })
    await expect(card).toContainText(`${YEAR}`)
    await expect(card).toContainText("123,000,000")
    expect(await prisma.companyYear.count({ where: { year: YEAR } })).toBe(0)

    const ok = card.getByRole("button", { name: "확인" })
    await reactReady(ok)
    await ok.click()
    await expect(page.locator("[data-agent-card=EXECUTED]")).toBeVisible({ timeout: 60_000 })
    const row = await prisma.companyYear.findFirstOrThrow({ where: { year: YEAR, basis: "PLANNED" } })
    expect(Number(row.revenueKrw)).toBe(123_000_000)
    expect(row.headcount).toBe(7)
  } finally {
    const rows = await prisma.companyYear.findMany({ where: { year: YEAR }, select: { id: true } })
    await prisma.activityLog.deleteMany({ where: { entityId: { in: rows.map((r) => r.id) } } })
    await prisma.companyYear.deleteMany({ where: { year: YEAR } })
    await prisma.$disconnect()
  }
})
