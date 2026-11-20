/**
 * 앱 AI(옴니스 대화방)로 CRM 출고 수량 고치기(#248 묶음 2) — update_shipment 가 확인 카드(수량 전 → 뒤)를 띄우고,
 * 확인하면 화면 API 와 같은 서버 함수(lib/crm-ops.ts updateShipment)로 출고와 재고 장부가 함께 바뀐다.
 * 시험 모델(OMNIS_AGENT_FAKE=1)이 글 속 [[도구 {입력}]] 대로 도구를 부른다. 기관 · 제품 이름은 지어낸 것이다.
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

test("앱 AI — 출고 수량 고치기는 확인 카드에 수량 전 → 뒤가 보이고, 확인하면 재고 장부가 따라간다", async ({ page }) => {
  test.skip(!LOCAL_DB, "시험 DB 를 직접 쓰고 읽는다")
  test.setTimeout(120_000)
  const prisma = new PrismaClient()
  const org = await prisma.crmOrg.create({ data: { name: `시험출고기관${stamp}`, code: `ORGS${stamp}`, type: "COMPANY" } })
  const product = await prisma.crmProduct.create({ data: { name: `시험출고젤${stamp}`, spec: "1ml", code: `PRDS${stamp}` } })
  const at = new Date("2026-11-17T00:00:00Z")
  await prisma.crmStockMove.create({ data: { movedAt: at, productId: product.id, direction: "IN", quantity: 10, note: "시험 입고" } })
  const ship = await prisma.crmShipment.create({
    data: { code: `SHS${stamp}`, shippedAt: at, kind: "SALE", status: "PREPARING", orgId: org.id, productId: product.id, quantity: 4 },
  })
  await prisma.crmStockMove.create({ data: { movedAt: at, productId: product.id, direction: "OUT", quantity: 4, note: `출고 ${ship.code}`, shipmentId: ship.id } })
  const balance = async () => (await prisma.crmStockMove.findMany({ where: { productId: product.id } }))
    .reduce((a, m) => a + Number(m.quantity) * (m.direction === "IN" ? 1 : -1), 0)
  try {
    await page.addInitScript(() => {
      localStorage.setItem("omnis:nudge-off:install", "1")
      localStorage.setItem("omnis:nudge-off:push", "1")
    })
    await quickLogin(page, "사원1")
    await page.goto("/chat/new")
    await box(page).waitFor({ timeout: 30_000 })
    await reactReady(box(page))
    await box(page).fill(`출고 수량을 2개로, 배송중으로 [[update_shipment ${JSON.stringify({ shipment_id: ship.id, quantity: 2, status: "SHIPPING" })}]]`)
    await box(page).press("Enter")

    const card = page.locator("[data-agent-card=PENDING]")
    await expect(card).toBeVisible({ timeout: 60_000 })
    await expect(card).toContainText(ship.code)
    await expect(card).toContainText("4개")
    await expect(card).toContainText("2개")
    await expect(card).toContainText("배송중")
    expect(await balance()).toBe(6)

    const ok = card.getByRole("button", { name: "확인" })
    await reactReady(ok)
    await ok.click()
    await expect(page.locator("[data-agent-card=EXECUTED]")).toBeVisible({ timeout: 60_000 })
    const after = await prisma.crmShipment.findUniqueOrThrow({ where: { id: ship.id } })
    expect(after.quantity).toBe(2)
    expect(after.status).toBe("SHIPPING")
    expect(await balance()).toBe(8)
  } finally {
    await prisma.crmStockMove.deleteMany({ where: { productId: product.id } })
    await prisma.crmShipment.deleteMany({ where: { orgId: org.id } })
    await prisma.crmOrg.deleteMany({ where: { id: org.id } })
    await prisma.crmProduct.deleteMany({ where: { id: product.id } })
    await prisma.$disconnect()
  }
})
