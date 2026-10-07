import "dotenv/config"
import { test, expect } from "@playwright/test"
import { randomUUID } from "node:crypto"
import { prisma } from "../../lib/db"
import { login } from "./_setup"

/**
 * 연혁 후보 — AI 가 올린 후보를 사람이 채택 · 제외한다.
 * AI 를 부르지 않는다: 후보는 시험이 직접 넣는다(추출 품질은 scripts/verify-record-proposals.ts 와 실측 보고서가 맡는다).
 */
test.describe("연혁 후보 (AI 제안 · 연혁 탭)", () => {
  const tag = randomUUID().slice(0, 8)
  const secretTitle = `시험 인비트로큐 업무협약 ${tag}`
  const plainTitle = `시험 포럼 참석 ${tag}`
  const ids: string[] = []

  test.beforeAll(async () => {
    const base = {
      confidence: 0.9,
      reason: "e2e",
      sourceRefs: [{ kind: "message", id: "e2e", label: "시험 2026-08-18", quote: "e2e 근거" }],
      trigger: "e2e",
    }
    const a = await prisma.recordProposal.create({
      data: { ...base, kind: "MILESTONE", grade: "MAJOR", confidential: true, title: secretTitle, occurredOn: new Date("2026-08-18T00:00:00Z"), original: { title: secretTitle } },
    })
    const b = await prisma.recordProposal.create({
      data: { ...base, kind: "FORUM", grade: "GENERAL", confidential: false, title: plainTitle, occurredOn: new Date("2026-08-17T00:00:00Z"), original: { title: plainTitle } },
    })
    ids.push(a.id, b.id)
  })

  test.afterAll(async () => {
    const rows = await prisma.recordProposal.findMany({ where: { id: { in: ids } }, select: { recordId: true } })
    await prisma.recordProposal.deleteMany({ where: { id: { in: ids } } })
    await prisma.companyRecord.deleteMany({ where: { id: { in: rows.map((r) => r.recordId).filter((x): x is string => !!x) } } })
    await prisma.$disconnect()
  })

  test("대외비 후보를 채택하면 연혁에 [내부용·대외비] · INTERNAL 로 들어가고, 다른 후보는 제외된다", async ({ page }) => {
    await login(page, "팀장")
    await page.goto("/omnis/proposals?tab=records")

    const secret = page.locator("article", { hasText: secretTitle })
    await expect(secret.getByText("대외비")).toBeVisible()
    await expect(secret.getByText("기업현황카드 후보")).toBeVisible()
    await secret.getByRole("button", { name: "채택", exact: true }).click()
    await expect(page.getByText("연혁에 넣었습니다")).toBeVisible()

    const plain = page.locator("article", { hasText: plainTitle })
    await plain.getByRole("button", { name: "제외" }).click()
    await expect(page.getByText("제외했습니다")).toBeVisible()

    const accepted = await prisma.recordProposal.findUniqueOrThrow({ where: { id: ids[0] }, include: { record: true } })
    expect(accepted.status).toBe("ACCEPTED")
    expect(accepted.edited).toBe(false)
    expect(accepted.record?.title).toBe(`[내부용·대외비] ${secretTitle}`)
    expect(accepted.record?.visibility).toBe("INTERNAL")
    expect(accepted.record?.category).toBe("주요")

    const rejected = await prisma.recordProposal.findUniqueOrThrow({ where: { id: ids[1] } })
    expect(rejected.status).toBe("REJECTED")
    expect(rejected.recordId).toBeNull()

    // 연혁 화면에 대외비 표시가 붙는다
    await page.goto(`/omnis/records?q=${encodeURIComponent(tag)}`)
    await expect(page.locator(`#rec-${accepted.record!.id}`).getByText("대외비", { exact: true })).toBeVisible()
  })
})
