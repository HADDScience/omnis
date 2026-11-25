/**
 * CRM 생산 기록 — 젤 타입 재고 구조(2026-11-25).
 *
 * 지키는 것
 * - 「생산 적기」 팝업이 한 단계씩 열린다: 타입 → 농도(지금 재고) → 만든 ml → 날짜 · 메모 → 확인(원재료 차감 미리보기)
 * - 적으면 그 (타입, 농도) 칸의 ml 가 는다. 개수는 세지 않는다. 원재료가 농도/100 × ml(농도는 g/100ml) 만큼 준다
 * - 고치면 재고 · 원재료 차감을 다시 계산하고, 지우면 생산 전으로 돌아간다. 셋 다 활동 기록에 남는다
 *
 * 데모 시드: 애드젤 1% 40ml(MFG001), 코팅 원료 499.6g. 시험은 10% 칸을 쓴다(시드에 없는 칸).
 */
import { expect, test } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { quickLogin } from "./_setup"

test.describe("CRM 생산 @crm", () => {
  test.describe.configure({ mode: "serial" })
  test.slow()
  const prisma = new PrismaClient()

  test.afterAll(async () => {
    // 이 시험이 남긴 생산이 있으면 지운다(재고 줄은 Cascade)
    await prisma.crmProduction.deleteMany({ where: { note: { startsWith: "e2e 생산" } } })
    await prisma.$disconnect()
  })

  test("팝업으로 생산 → 재고 반영 → 고치기 → 지우기 (폰 폭)", async ({ page }, info) => {
    // 폰에서 쓰는 화면이다 — 390px 에서 단계가 다 보이고 눌려야 한다
    await page.setViewportSize({ width: 390, height: 844 })
    await quickLogin(page, "팀장")
    await page.goto("/crm/inventory")
    const lot = page.locator('[data-gel-lot="ADDGEL@10"]')
    await expect(page.locator('[data-gel-stock="ADDGEL"]')).toBeVisible({ timeout: 30_000 })
    await expect(lot).toHaveCount(0)
    const materialBefore = await materialGrams(prisma)

    // ① 타입 → ② 농도 → ③ 만든 ml → ④ 메모 → ⑤ 확인
    await page.locator("[data-open-production]").click()
    const dlg = page.locator("[data-production-dialog]")
    await expect(dlg).toBeVisible()
    await dlg.locator('[data-gel-type="ADDGEL"]').click()
    await dlg.getByRole("group", { name: "자주 쓰는 농도" }).getByRole("button", { name: "10%" }).click()
    await expect(dlg.locator("[data-gel-lot-stock]")).toContainText("0ml")
    // 개수 칸이 없다 — ml 하나만 받는다
    await expect(dlg.getByLabel(/개수/)).toHaveCount(0)
    await dlg.getByRole("group", { name: "자주 쓰는 ml" }).getByRole("button", { name: "20ml" }).click()
    await expect(dlg.locator("[data-production-total]")).toContainText("20ml")
    await dlg.getByLabel("만든 양(ml)").fill("25")
    await expect(dlg.locator("[data-production-total]")).toContainText("25ml")
    await dlg.getByLabel("메모").fill("e2e 생산 1")
    const confirm = dlg.locator("[data-production-confirm]")
    await expect(confirm).toContainText("25ml")
    await expect(confirm).not.toContainText("개") // 개수 줄이 없다
    // 원재료 = 10/100 × 25ml = 2.5g (농도는 g/100ml)
    await expect(dlg.locator("[data-material-grams]")).toContainText("−2.5g")
    await expect(confirm).toContainText("g/100ml")
    await expect(confirm).not.toContainText("wt")
    await page.screenshot({ path: info.outputPath("01-dialog-confirm-390.png"), fullPage: false })
    await dlg.getByRole("button", { name: "생산 적기" }).click()
    await expect(dlg).toBeHidden({ timeout: 20_000 })

    // 재고 반영 — 10% 칸 25ml, 개수 표시는 없다
    await expect(lot).toContainText("25ml")
    await expect(lot).not.toContainText("×")
    await lot.scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath("02-gel-stock-390.png"), fullPage: false })
    const made = await prisma.crmProduction.findFirstOrThrow({ where: { note: "e2e 생산 1" }, include: { stockMoves: true } })
    expect(Number(made.totalMl)).toBe(25)
    expect(made.quantity).toBeNull()
    expect(Number(made.materialGrams)).toBe(2.5)
    expect(made.stockMoves.length).toBe(2) // 완제품 IN(ml) + 원재료 OUT(g)
    expect(await materialGrams(prisma)).toBeCloseTo(materialBefore - 2.5, 3)
    expect(await activity(prisma, made.id, "create")).toBe(1)

    // 고치기 — 30ml 로: 원재료 3g
    const row = page.locator(`[data-production="${made.code}"]`)
    await row.getByRole("button", { name: `${made.code} 고치기` }).click()
    await expect(dlg).toBeVisible()
    await expect(dlg.locator("[data-gel-lot-stock]")).toContainText("25ml")
    await expect(dlg.getByLabel("만든 양(ml)")).toHaveValue("25")
    await dlg.getByLabel("만든 양(ml)").fill("30")
    await expect(dlg.locator("[data-production-total]")).toContainText("30ml")
    // 고치기 미리보기는 이 생산분을 빼고 본다 — 10% 칸 0ml → 30ml
    await expect(dlg.locator("[data-production-confirm]")).toContainText("0ml → 30ml")
    await dlg.getByRole("button", { name: "고친 대로 저장" }).click()
    await expect(dlg).toBeHidden({ timeout: 20_000 })
    await expect(lot).toContainText("30ml")
    expect(await materialGrams(prisma)).toBeCloseTo(materialBefore - 3, 3)
    expect(await activity(prisma, made.id, "update")).toBe(1)

    // 지우기 — 두 번 눌러야 지운다. 생산 전으로 돌아간다
    await row.getByRole("button", { name: `${made.code} 지우기` }).click()
    await row.getByRole("button", { name: `${made.code} 정말 지우기` }).click()
    await expect(row).toHaveCount(0, { timeout: 20_000 })
    await expect(lot).toHaveCount(0)
    expect(await materialGrams(prisma)).toBeCloseTo(materialBefore, 3)
    expect(await prisma.crmStockMove.count({ where: { productionId: made.id } })).toBe(0)
    expect(await activity(prisma, made.id, "delete")).toBe(1)
  })
})

/** 데모 원료(코팅 원료) 재고 g */
async function materialGrams(prisma: PrismaClient) {
  const m = await prisma.crmProduct.findFirstOrThrow({ where: { isMaterial: true, archived: false } })
  const moves = await prisma.crmStockMove.findMany({ where: { productId: m.id } })
  return moves.reduce((a, x) => a + (x.direction === "IN" ? 1 : -1) * Number(x.quantity), 0)
}

const activity = (prisma: PrismaClient, id: string, action: string) =>
  prisma.activityLog.count({ where: { entity: "crm.production", entityId: id, action } })
