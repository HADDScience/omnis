/**
 * 앱 AI(옴니스 대화방)로 지식재산권 미결 액션 남기기(#248 묶음 5) — ip_save_action 이 확인 카드(건 · 할 일)를 띄우고,
 * 확인하면 화면(메일 정리)과 같은 lib/ip-data saveAction 으로 ip.actions 에 한 줄이 생긴다.
 * 시험 모델(OMNIS_AGENT_FAKE=1)이 글 속 [[도구 {입력}]] 대로 도구를 부른다. 상표 이름은 지어낸 것이다.
 */
import { expect, test, type Locator, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { quickLogin } from "./_setup"

const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")
const stamp = Date.now()
const TM = `TM-E2E${stamp}`
const TODO = `시험 할 일 ${stamp}`

const box = (page: Page) => page.locator("[data-composer-pill] textarea").first()
const reactReady = (el: Locator) =>
  expect.poll(() => el.evaluate((n) => Object.keys(n).some((k) => k.startsWith("__reactProps"))), { timeout: 30_000 }).toBe(true)

test.use({ viewport: { width: 1280, height: 860 } })

test("앱 AI — 지식재산권 액션 남기기는 확인 카드에 건 · 할 일이 보이고, 확인하면 액션이 생긴다", async ({ page }) => {
  test.skip(!LOCAL_DB, "시험 DB 를 직접 쓰고 읽는다")
  test.setTimeout(120_000)
  const prisma = new PrismaClient()
  await prisma.$executeRaw`
    INSERT INTO ip.trademarks (id, name, status, kind)
    VALUES (${TM}, ${`시험상표${stamp}`}, (SELECT value FROM ip.status_options WHERE kind = 'trademark' ORDER BY sort_order LIMIT 1), 'trademark')`
  try {
    await page.addInitScript(() => {
      localStorage.setItem("omnis:nudge-off:install", "1")
      localStorage.setItem("omnis:nudge-off:push", "1")
    })
    await quickLogin(page, "사원1")
    await page.goto("/chat/new")
    await box(page).waitFor({ timeout: 30_000 })
    await reactReady(box(page))
    await box(page).fill(`액션 남겨 줘 [[ip_save_action ${JSON.stringify({ case: TM, todo: TODO, priority: "높음" })}]]`)
    await box(page).press("Enter")

    const card = page.locator("[data-agent-card=PENDING]")
    await expect(card).toBeVisible({ timeout: 60_000 })
    await expect(card).toContainText(TM)
    await expect(card).toContainText(TODO)
    const none = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM ip.actions WHERE todo = ${TODO}`
    expect(Number(none[0].n)).toBe(0)

    const ok = card.getByRole("button", { name: "확인" })
    await reactReady(ok)
    await ok.click()
    await expect(page.locator("[data-agent-card=EXECUTED]")).toBeVisible({ timeout: 60_000 })
    const rows = await prisma.$queryRaw<{ subject: string; state: string; priority: string }[]>`SELECT subject, state, priority FROM ip.actions WHERE todo = ${TODO}`
    expect(rows).toHaveLength(1)
    expect(rows[0].subject).toContain(TM)
    expect(rows[0].state).toBe("open")
    expect(rows[0].priority).toBe("높음")
  } finally {
    await prisma.$executeRaw`DELETE FROM ip.actions WHERE todo = ${TODO}`
    await prisma.$executeRaw`DELETE FROM ip.trademarks WHERE id = ${TM}`
    await prisma.$disconnect()
  }
})
