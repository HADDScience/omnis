/**
 * 앱 AI(옴니스 대화방)로 홈페이지 기사 고정(#248 묶음 6) — arrange_website_posts 가 확인 카드(고정 아님 → 고정)를 띄우고,
 * 확인하면 관리 화면과 같은 lib/website-posts setPinned 로 기사가 고정된다. 기사 제목 · 본문은 지어낸 것이다.
 */
import { expect, test, type Locator, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { quickLogin } from "./_setup"

const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")
const ID = `${Date.now()}`.slice(0, 12)

const box = (page: Page) => page.locator("[data-composer-pill] textarea").first()
const reactReady = (el: Locator) =>
  expect.poll(() => el.evaluate((n) => Object.keys(n).some((k) => k.startsWith("__reactProps"))), { timeout: 30_000 }).toBe(true)

test.use({ viewport: { width: 1280, height: 860 } })

test("앱 AI — 홈페이지 기사 고정은 확인 카드에 고정 전 → 뒤가 보이고, 확인하면 고정된다", async ({ page }) => {
  test.skip(!LOCAL_DB, "시험 DB 를 직접 쓰고 읽는다")
  test.setTimeout(120_000)
  const prisma = new PrismaClient()
  await prisma.websitePost.create({
    data: { id: ID, position: 9999, date: "2026.11.18", sourceLang: "ko", content: { ko: { title: `시험기사${ID}`, summary: "시험 요약", blocks: [] } } },
  })
  try {
    await page.addInitScript(() => {
      localStorage.setItem("omnis:nudge-off:install", "1")
      localStorage.setItem("omnis:nudge-off:push", "1")
    })
    await quickLogin(page, "사원1")
    await page.goto("/chat/new")
    await box(page).waitFor({ timeout: 30_000 })
    await reactReady(box(page))
    await box(page).fill(`이 기사 고정해 줘 [[arrange_website_posts ${JSON.stringify({ action: "pin", id: ID })}]]`)
    await box(page).press("Enter")

    const card = page.locator("[data-agent-card=PENDING]")
    await expect(card).toBeVisible({ timeout: 60_000 })
    await expect(card).toContainText(`시험기사${ID}`)
    await expect(card).toContainText("고정")
    expect((await prisma.websitePost.findUniqueOrThrow({ where: { id: ID } })).pinned).toBe(false)

    const ok = card.getByRole("button", { name: "확인" })
    await reactReady(ok)
    await ok.click()
    await expect(page.locator("[data-agent-card=EXECUTED]")).toBeVisible({ timeout: 60_000 })
    expect((await prisma.websitePost.findUniqueOrThrow({ where: { id: ID } })).pinned).toBe(true)
  } finally {
    await prisma.websitePost.deleteMany({ where: { id: ID } })
    await prisma.$disconnect()
  }
})
