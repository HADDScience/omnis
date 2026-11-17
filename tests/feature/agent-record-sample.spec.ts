/**
 * 앱 AI(옴니스 대화방)에서 샘플 전달 기록 — 도구 레지스트리(lib/tools/registry.ts)로 연 record_sample 이
 * 실제 Workflow · 확인 카드 · 실행 경로를 지난다. 시험 모델(OMNIS_AGENT_FAKE=1)이 글 속 [[도구 {입력}]] 대로 도구를 부른다.
 * 제품 이름은 운영과 같은 「한글 (English)」 모양 — 한글 이름 + 규격으로 불러도 찾는다. 기관 · 제품 이름은 지어낸 것이다.
 */
import { expect, test, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { quickLogin } from "./_setup"

const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")
const stamp = Date.now()
const ORG = `시험전달기관${stamp}`
const PRODUCT = `시험젤${stamp} (Test Gel)`

const box = (page: Page) => page.locator("[data-composer-pill] textarea").first()
const hydrated = (page: Page) =>
  expect.poll(() => box(page).evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))), { timeout: 30_000 }).toBe(true)

test.use({ viewport: { width: 1280, height: 860 } })

test("앱 AI — 샘플 전달 기록은 확인 카드로 미리 보이고, 확인하면 샘플요청 · 출고 · 재고가 남는다", async ({ page }) => {
  test.skip(!LOCAL_DB, "시험 DB 를 직접 쓰고 읽는다")
  test.setTimeout(120_000)
  const prisma = new PrismaClient()
  const org = await prisma.crmOrg.create({ data: { name: ORG, code: `ORGA${stamp}`, type: "COMPANY" } })
  const product = await prisma.crmProduct.create({ data: { name: PRODUCT, spec: "2ml", code: `PRDA${stamp}` } })
  try {
    await page.addInitScript(() => {
      localStorage.setItem("omnis:nudge-off:install", "1")
      localStorage.setItem("omnis:nudge-off:push", "1")
    })
    await quickLogin(page, "사원1")
    await page.goto("/chat/new")
    await box(page).waitFor({ timeout: 30_000 })
    await hydrated(page)
    const input = { org: ORG, product: `시험젤${stamp} 2ml`, quantity: 3, contact: "시험 담당", content: "시험 샘플 전달" }
    await box(page).fill(`샘플 전달 남겨 줘 [[record_sample ${JSON.stringify(input)}]]`)
    await box(page).press("Enter")

    // 미리보기 — 확인 카드에 기관 · 제품 · 재고가 보이고, 아직 아무것도 쓰지 않았다
    const card = page.locator("[data-agent-card=PENDING]")
    await expect(card).toBeVisible({ timeout: 60_000 })
    await expect(card).toContainText(ORG)
    await expect(card).toContainText(`${PRODUCT} 2ml`)
    expect(await prisma.crmSampleRequest.count({ where: { orgId: org.id } })).toBe(0)

    // 확인 — 같은 runTool(confirm=true)로 쓴다
    await card.getByRole("button", { name: "확인" }).click()
    await expect(page.locator("[data-agent-card=EXECUTED]")).toBeVisible({ timeout: 60_000 })
    const samples = await prisma.crmSampleRequest.findMany({ where: { orgId: org.id }, include: { shipments: { include: { stockMoves: true } } } })
    expect(samples).toHaveLength(1)
    expect(samples[0].status).toBe("SENT")
    const moves = samples[0].shipments.flatMap((s) => s.stockMoves)
    expect(moves.map((m) => [m.productId, m.direction, Number(m.quantity)])).toEqual([[product.id, "OUT", 3]])
    const step = await prisma.agentStep.findFirst({ where: { toolName: "record_sample", run: { userId: (await prisma.user.findFirstOrThrow({ where: { name: "사원1" } })).id } }, orderBy: { createdAt: "desc" } })
    expect(step?.status).toBe("EXECUTED")
  } finally {
    const shipments = await prisma.crmShipment.findMany({ where: { orgId: org.id }, select: { id: true } })
    const samples = await prisma.crmSampleRequest.findMany({ where: { orgId: org.id }, select: { id: true } })
    await prisma.crmStockMove.deleteMany({ where: { shipmentId: { in: shipments.map((s) => s.id) } } })
    await prisma.crmShipment.deleteMany({ where: { orgId: org.id } })
    await prisma.crmSampleRequest.deleteMany({ where: { orgId: org.id } })
    await prisma.activityLog.deleteMany({ where: { entityId: { in: [org.id, ...samples.map((s) => s.id)] } } })
    await prisma.crmOrg.deleteMany({ where: { id: org.id } })
    await prisma.crmProduct.deleteMany({ where: { id: product.id } })
    await prisma.$disconnect()
  }
})
