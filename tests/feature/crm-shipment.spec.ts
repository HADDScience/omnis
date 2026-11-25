/**
 * CRM 출고 기록 — 생산과 같은 단계별 팝업(2026-11-25 3차).
 *
 * 지키는 것
 * - 「출고 적기」 팝업이 한 단계씩 열린다: 무엇을 → 농도(지금 재고) → 나가는 ml → 거래처 · 날짜 · 메모 → 확인(재고 차감 미리보기)
 * - 적으면 그 (타입, 농도) 칸의 ml 가 준다. 개수는 세지 않는다. 재고보다 많으면 막지 않고 빨갛게 알린다
 * - 고치면 이 출고분을 돌려놓고 다시 빼고, 지우면 출고 전으로 돌아간다. 셋 다 활동 기록에 남는다
 *
 * 데모 시드: 애드젤 1% 칸에 재고가 있다(생산 MFG001). 시험은 그 칸을 쓰고 끝나면 지운다.
 */
import { expect, test } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { quickLogin } from "./_setup"

test.describe("CRM 출고 @crm", () => {
  test.describe.configure({ mode: "serial" })
  test.slow()
  const prisma = new PrismaClient()

  test.afterAll(async () => {
    // 이 시험이 남긴 출고가 있으면 지운다(재고 줄은 Cascade)
    await prisma.crmShipment.deleteMany({ where: { note: { startsWith: "e2e 출고" } } })
    await prisma.$disconnect()
  })

  test("팝업으로 출고 → 재고 차감 → 고치기(모자람 경고) → 지우기 (폰 폭)", async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await quickLogin(page, "팀장")
    await page.goto("/crm/inventory")
    const lot = page.locator('[data-gel-lot="ADDGEL@1"]')
    await expect(lot).toBeVisible({ timeout: 30_000 })
    const before = await addgelMl(prisma, 1)
    expect(before).toBeGreaterThan(5)
    const firstOrg = await prisma.crmOrg.findFirstOrThrow({ orderBy: { name: "asc" } })

    // ① 무엇을 → ② 농도 → ③ ml → ④ 거래처 · 날짜 · 메모 → ⑤ 확인
    await page.locator("[data-open-shipment]").click()
    const dlg = page.locator("[data-shipment-dialog]")
    await expect(dlg).toBeVisible()
    await dlg.locator('[data-gel-type="ADDGEL"]').click()
    await dlg.getByRole("group", { name: "자주 쓰는 농도" }).getByRole("button", { name: "1%", exact: true }).click()
    await expect(dlg.locator("[data-gel-lot-stock]")).toContainText(`${before}ml`)
    await expect(dlg.getByLabel(/몇 개/)).toHaveCount(0) // 젤은 개수 칸이 없다
    await dlg.getByRole("group", { name: "자주 쓰는 ml" }).getByRole("button", { name: "5ml", exact: true }).click()
    await dlg.locator("[data-shipment-org]").getByRole("button").first().click()
    await page.getByRole("option", { name: firstOrg.name }).click()
    await dlg.getByLabel("메모").fill("e2e 출고 1")
    const confirm = dlg.locator("[data-shipment-confirm]")
    await expect(confirm).toContainText(firstOrg.name)
    await expect(dlg.locator("[data-shipment-stock]")).toContainText(`${before}ml → ${round3(before - 5)}ml`)
    await expect(confirm).not.toContainText("개")
    await expect(dlg.locator("[data-shipment-short]")).toHaveCount(0)
    await page.screenshot({ path: info.outputPath("01-shipment-confirm-390.png"), fullPage: false })
    await dlg.getByRole("button", { name: "출고 적기" }).click()
    await expect(dlg).toBeHidden({ timeout: 20_000 })

    // 재고 반영 — 1% 칸이 5ml 준다
    await expect(lot).toContainText(`${round3(before - 5)}ml`)
    const made = await prisma.crmShipment.findFirstOrThrow({ where: { note: "e2e 출고 1" }, include: { stockMoves: true } })
    expect(Number(made.volumeMl)).toBe(5)
    expect(made.quantity).toBeNull()
    expect(made.stockMoves.length).toBe(1)
    expect(Number(made.stockMoves[0].concentrationPct)).toBe(1)
    expect(await addgelMl(prisma, 1)).toBeCloseTo(before - 5, 3)
    expect(await activity(prisma, made.id, "create")).toBe(1)

    // 고치기 — 이 출고분(5ml)을 돌려놓고 본다. 재고보다 많으면 빨갛게 알리고, 8ml 로 저장
    const row = page.locator(`[data-shipment="${made.code}"]`)
    await row.getByRole("button", { name: `${made.code} 고치기` }).click()
    await expect(dlg).toBeVisible()
    await expect(dlg.getByLabel("나가는 양(ml)")).toHaveValue("5")
    await dlg.getByLabel("나가는 양(ml)").fill(String(before + 3))
    await expect(dlg.locator("[data-shipment-short]")).toContainText("3ml 모자랍니다")
    await dlg.getByLabel("나가는 양(ml)").fill("8")
    await expect(dlg.locator("[data-shipment-short]")).toHaveCount(0)
    await expect(dlg.locator("[data-shipment-stock]")).toContainText(`${before}ml → ${round3(before - 8)}ml`)
    await page.screenshot({ path: info.outputPath("02-shipment-edit-390.png"), fullPage: false })
    await dlg.getByRole("button", { name: "고친 대로 저장" }).click()
    await expect(dlg).toBeHidden({ timeout: 20_000 })
    await expect(lot).toContainText(`${round3(before - 8)}ml`)
    expect(await addgelMl(prisma, 1)).toBeCloseTo(before - 8, 3)
    expect(await activity(prisma, made.id, "update")).toBe(1)

    // 지우기 — 두 번 눌러야 지운다. 출고 전으로 돌아간다
    await row.getByRole("button", { name: `${made.code} 지우기` }).click()
    await row.getByRole("button", { name: `${made.code} 정말 지우기` }).click()
    await expect(row).toHaveCount(0, { timeout: 20_000 })
    await expect(lot).toContainText(`${before}ml`)
    expect(await addgelMl(prisma, 1)).toBeCloseTo(before, 3)
    expect(await activity(prisma, made.id, "delete")).toBe(1)
  })
})

const round3 = (n: number) => Math.round(n * 1000) / 1000

/** 데모 애드젤의 그 농도 칸 ml */
async function addgelMl(prisma: PrismaClient, conc: number) {
  const p = await prisma.crmProduct.findFirstOrThrow({ where: { gelType: "ADDGEL" } })
  const moves = await prisma.crmStockMove.findMany({ where: { productId: p.id, concentrationPct: conc } })
  return round3(moves.reduce((a, x) => a + (x.direction === "IN" ? 1 : -1) * Number(x.quantity), 0))
}

const activity = (prisma: PrismaClient, id: string, action: string) =>
  prisma.activityLog.count({ where: { entity: "crm.shipment", entityId: id, action } })
