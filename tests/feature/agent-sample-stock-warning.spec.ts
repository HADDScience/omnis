/**
 * 앱 AI 샘플 전달 확인 카드 — product_id 로 고른 제품의 재고 변화(지금 → 뒤)를 보이고, 모자라면 경고한다.
 * 시험 모델(OMNIS_AGENT_FAKE=1)이 글 속 [[도구 {입력}]] 대로 record_sample 을 부른다. 기관 · 제품 이름은 지어낸 것이다.
 */
import { expect, test, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { quickLogin } from "./_setup"

const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")
const stamp = Date.now()

const box = (page: Page) => page.locator("[data-composer-pill] textarea").first()
const hydrated = (page: Page) =>
  expect.poll(() => box(page).evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))), { timeout: 30_000 }).toBe(true)

test.use({ viewport: { width: 1280, height: 860 } })

test("재고가 모자라면 확인 카드에 지금 → 뒤 재고와 경고가 보이고, 확인 전에는 아무것도 쓰지 않는다", async ({ page }) => {
  test.skip(!LOCAL_DB, "시험 DB 를 직접 쓰고 읽는다")
  test.setTimeout(120_000)
  const prisma = new PrismaClient()
  const org = await prisma.crmOrg.create({ data: { name: `시험재고기관${stamp}`, code: `ORGW${stamp}`, type: "COMPANY" } })
  const product = await prisma.crmProduct.create({ data: { name: `시험재고젤${stamp} (Stock Gel)`, spec: "2ml", code: `PRDW${stamp}` } })
  await prisma.crmStockMove.create({ data: { productId: product.id, direction: "IN", quantity: 2, movedAt: new Date(), note: "시험 입고" } })
  try {
    await page.addInitScript(() => {
      localStorage.setItem("omnis:nudge-off:install", "1")
      localStorage.setItem("omnis:nudge-off:push", "1")
    })
    await quickLogin(page, "사원1")
    await page.goto("/chat/new")
    await box(page).waitFor({ timeout: 30_000 })
    await hydrated(page)
    const input = { org: org.name, product_id: product.id, quantity: 3 }
    await box(page).fill(`샘플 남겨 줘 [[record_sample ${JSON.stringify(input)}]]`)
    await box(page).press("Enter")

    const card = page.locator("[data-agent-card=PENDING]")
    await expect(card).toBeVisible({ timeout: 60_000 })
    await expect(card).toContainText(`시험재고젤${stamp} (Stock Gel) 2ml`)
    // 재고: 지금 2개 → 뒤 -1개 (지금 값은 지운 줄로)
    const stockRow = card.locator("dl > div").filter({ hasText: "재고" }).last()
    await expect(stockRow).toContainText("2개")
    await expect(stockRow).toContainText("-1개")
    const warning = card.locator("[data-agent-card-warning]")
    await expect(warning).toBeVisible()
    await expect(warning).toContainText("재고가 모자랍니다")
    // 확인 단추는 그대로 — 사용자가 판단한다. 누르기 전에는 아무것도 쓰지 않았다
    await expect(card.getByRole("button", { name: "확인" })).toBeEnabled()
    expect(await prisma.crmSampleRequest.count({ where: { orgId: org.id } })).toBe(0)
    expect(await prisma.crmStockMove.count({ where: { productId: product.id } })).toBe(1)
  } finally {
    await prisma.crmSampleRequest.deleteMany({ where: { orgId: org.id } })
    await prisma.crmStockMove.deleteMany({ where: { productId: product.id } })
    await prisma.crmOrg.deleteMany({ where: { id: org.id } })
    await prisma.crmProduct.deleteMany({ where: { id: product.id } })
    await prisma.$disconnect()
  }
})
