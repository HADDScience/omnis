/**
 * 앱 AI(옴니스 대화방)로 지식 카드 지우기(#248 묶음 3) — delete_omnis_card 가 확인 카드(지울 카드 본문)를 띄우고,
 * 「지우기」 를 누르면 화면 API 와 같은 서버 함수(lib/omnis-cards.ts deleteOmnisCard)로 카드가 지워지고 활동 기록이 남는다.
 * 시험 모델(OMNIS_AGENT_FAKE=1)이 글 속 [[도구 {입력}]] 대로 도구를 부른다. 카드 이름 · 본문은 지어낸 것이다.
 */
import { expect, test, type Locator, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { quickLogin } from "./_setup"

const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")
const stamp = Date.now()

const box = (page: Page) => page.locator("[data-composer-pill] textarea").first()
const reactReady = (el: Locator) =>
  expect.poll(() => el.evaluate((n) => Object.keys(n).some((k) => k.startsWith("__reactProps"))), { timeout: 30_000 }).toBe(true)

test.use({ viewport: { width: 1280, height: 860 } })

test("앱 AI — 지식 카드 지우기는 확인 카드에 지울 본문이 보이고, 「지우기」 를 누르면 카드가 사라진다", async ({ page }) => {
  test.skip(!LOCAL_DB, "시험 DB 를 직접 쓰고 읽는다")
  test.setTimeout(120_000)
  const prisma = new PrismaClient()
  const category = await prisma.omnisCategory.create({ data: { name: `시험분류${stamp}`, icon: "🧪", sortOrder: 999 } })
  const card = await prisma.omnisCard.create({
    data: { categoryId: category.id, title: `시험지울카드${stamp}`, content: { version: 2, sections: [{ id: "s1", type: "text", title: "", body: "지울 시험 본문입니다" }] } },
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
    await box(page).fill(`이 카드 지워 줘 [[delete_omnis_card ${JSON.stringify({ card: card.id })}]]`)
    await box(page).press("Enter")

    const pending = page.locator("[data-agent-card=PENDING]")
    await expect(pending).toBeVisible({ timeout: 60_000 })
    await expect(pending).toContainText(card.title)
    await expect(pending).toContainText("지울 시험 본문입니다")
    expect(await prisma.omnisCard.count({ where: { id: card.id } })).toBe(1)

    const del = pending.getByRole("button", { name: "지우기" })
    await reactReady(del)
    await del.click()
    await expect(page.locator("[data-agent-card=EXECUTED]")).toBeVisible({ timeout: 60_000 })
    expect(await prisma.omnisCard.count({ where: { id: card.id } })).toBe(0)
    const log = await prisma.activityLog.findFirst({ where: { entity: "OMNIS_CARD", entityId: card.id, action: "omnis.deleted" } })
    expect(log?.title).toContain(card.title)
  } finally {
    await prisma.omnisCard.deleteMany({ where: { id: card.id } })
    await prisma.activityLog.deleteMany({ where: { entityId: { in: [card.id, category.id] } } })
    await prisma.omnisCategory.deleteMany({ where: { id: category.id } })
    await prisma.$disconnect()
  }
})
