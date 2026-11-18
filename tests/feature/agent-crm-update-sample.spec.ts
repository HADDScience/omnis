/**
 * 앱 AI(옴니스 대화방)로 CRM 샘플 기록 고치기 — update_sample 이 확인 카드(전 → 뒤 · 재고 변화)를 띄우고,
 * 확인하면 화면 API 와 같은 서버 함수(lib/crm-ops.ts)로 샘플 출고 수량과 재고 장부가 함께 바뀐다.
 * 시험 모델(OMNIS_AGENT_FAKE=1)이 글 속 [[도구 {입력}]] 대로 도구를 부른다. 기관 · 제품 이름은 지어낸 것이다.
 */
import { expect, test, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { quickLogin } from "./_setup"

const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")
const stamp = Date.now()
const ORG = `시험고침기관${stamp}`
const PRODUCT = `시험고침젤${stamp}`

const box = (page: Page) => page.locator("[data-composer-pill] textarea").first()
const hydrated = (page: Page) =>
  expect.poll(() => box(page).evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))), { timeout: 30_000 }).toBe(true)

test.use({ viewport: { width: 1280, height: 860 } })

test("앱 AI — 샘플 수량 고치기는 확인 카드에 출고 · 재고 전 → 뒤가 보이고, 확인하면 출고 · 재고가 따라간다", async ({ page }) => {
  test.skip(!LOCAL_DB, "시험 DB 를 직접 쓰고 읽는다")
  test.setTimeout(120_000)
  const prisma = new PrismaClient()
  const org = await prisma.crmOrg.create({ data: { name: ORG, code: `ORGU${stamp}`, type: "COMPANY" } })
  const product = await prisma.crmProduct.create({ data: { name: PRODUCT, spec: "2ml", code: `PRDU${stamp}` } })
  const at = new Date("2026-11-17T00:00:00Z")
  // 입고 10 · 샘플 출고 3(record_sample 이 남기는 모양) → 장부 재고 7
  await prisma.crmStockMove.create({ data: { movedAt: at, productId: product.id, direction: "IN", quantity: 10, note: "시험 입고" } })
  const sample = await prisma.crmSampleRequest.create({
    data: { code: `HADDU${stamp}`, requestedAt: at, orgId: org.id, productId: product.id, request: "시험 샘플 3개", status: "SENT", sentAt: at },
  })
  const ship = await prisma.crmShipment.create({
    data: { code: `SHU${stamp}`, shippedAt: at, kind: "SAMPLE", status: "DELIVERED", orgId: org.id, productId: product.id, quantity: 3, sampleRequestId: sample.id },
  })
  await prisma.crmStockMove.create({ data: { movedAt: at, productId: product.id, direction: "OUT", quantity: 3, note: `출고 ${ship.code}`, shipmentId: ship.id } })
  try {
    await page.addInitScript(() => {
      localStorage.setItem("omnis:nudge-off:install", "1")
      localStorage.setItem("omnis:nudge-off:push", "1")
    })
    await quickLogin(page, "사원1")
    await page.goto("/chat/new")
    await box(page).waitFor({ timeout: 30_000 })
    await hydrated(page)
    await box(page).fill(`샘플 수량을 1개로 고쳐 줘 [[update_sample ${JSON.stringify({ sample_id: sample.id, quantity: 1 })}]]`)
    await box(page).press("Enter")

    // 미리보기 — 카드에 출고 3 → 1, 재고 7 → 9 가 보이고 아직 아무것도 바뀌지 않았다
    const card = page.locator("[data-agent-card=PENDING]")
    await expect(card).toBeVisible({ timeout: 60_000 })
    await expect(card).toContainText(sample.code)
    await expect(card).toContainText(`${ship.code} · 3개`)
    await expect(card).toContainText("7개")
    await expect(card).toContainText("9개")
    expect((await prisma.crmShipment.findUniqueOrThrow({ where: { id: ship.id } })).quantity).toBe(3)

    // 확인 — runTool(confirm=true) → lib/crm-ops updateSampleRequest
    await card.getByRole("button", { name: "확인" }).click()
    await expect(page.locator("[data-agent-card=EXECUTED]")).toBeVisible({ timeout: 60_000 })
    expect((await prisma.crmShipment.findUniqueOrThrow({ where: { id: ship.id } })).quantity).toBe(1)
    const moves = await prisma.crmStockMove.findMany({ where: { productId: product.id } })
    const balance = moves.reduce((a, m) => a + Number(m.quantity) * (m.direction === "IN" ? 1 : -1), 0)
    expect(balance).toBe(9)
    const log = await prisma.activityLog.findFirst({ where: { entity: "crm.sample", entityId: sample.id, action: "update" } })
    expect(log?.title).toContain(sample.code)
  } finally {
    await prisma.crmStockMove.deleteMany({ where: { productId: product.id } })
    await prisma.crmShipment.deleteMany({ where: { orgId: org.id } })
    await prisma.crmSampleRequest.deleteMany({ where: { orgId: org.id } })
    await prisma.activityLog.deleteMany({ where: { entityId: { in: [org.id, sample.id] } } })
    await prisma.crmOrg.deleteMany({ where: { id: org.id } })
    await prisma.crmProduct.deleteMany({ where: { id: product.id } })
    await prisma.$disconnect()
  }
})
