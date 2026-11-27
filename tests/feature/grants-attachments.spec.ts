/**
 * 국가과제 공고 첨부 상태 — 수집기가 원문에서 확인한 첨부 있음 · 없음과, 받은 첨부를 읽었는지.
 *
 * 지키는 것
 * - 첨부가 없는 공고는 「첨부 없음 · 원문 확인 날짜」 가 보이고, 가점이 비면 「첨부 없음 · 본문만 봄」 까닭이 보인다
 * - 첨부를 못 읽은 공고는 첨부 칸에 까닭별 수, 파일 옆에 「이미지라 못 읽음」 이 보이고, 가점이 비면 「N개 중 M개를 읽지 못함」
 * - 폰에서도 같다
 */
import { expect, test, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { login } from "./_setup"

const prisma = new PrismaClient()
const stamp = Date.now()
const NONE = `e2e 첨부 없음 공고 ${stamp}`
const IMAGE = `e2e 이미지 첨부 공고 ${stamp}`
const ids: string[] = []

test.beforeAll(async () => {
  const base = {
    deadlineAt: new Date(Date.now() + 20 * 86_400_000),
    verdictSole: "해당",
    verdictCorp: "해당",
    judgedBy: "rules",
    regionDetail: [],
    fields: [],
    attCheckedAt: new Date("2026-11-27T06:10:00Z"),
  }
  const a = await prisma.grantNotice.create({
    data: { ...base, externalKey: `notice:e2e:att-none-${stamp}`, title: NONE, attStatus: "none", attNote: "상세 「첨부파일」 줄에 링크 0개", attFiles: { total: 0, items: [] }, bonusStatus: "no_text", bonusItems: [] },
  })
  const b = await prisma.grantNotice.create({
    data: {
      ...base,
      externalKey: `notice:e2e:att-image-${stamp}`,
      title: IMAGE,
      attStatus: "present",
      attachments: [
        { name: `스캔본${stamp}.pdf`, type: "PDF", size: 2048, url: "https://example.invalid/a" },
        { name: `공고문${stamp}.hwp`, type: "HWP", size: 4096, url: "https://example.invalid/b" },
      ],
      attFiles: { total: 2, items: [{ name: `스캔본${stamp}.pdf`, reason: "image" }] },
      bonusStatus: "ok",
      bonusItems: [],
    },
  })
  ids.push(a.id, b.id)
})

test.afterAll(async () => {
  await prisma.grantNotice.deleteMany({ where: { id: { in: ids } } })
  await prisma.$disconnect()
})

async function open(page: Page, title: string) {
  await page.goto(`/omnis/grants?tab=notices&q=${encodeURIComponent(String(stamp))}`)
  await page.getByRole("button", { name: `${title} 펼치기` }).click()
  return page.locator("li").filter({ has: page.getByRole("button", { name: `${title} 접기` }) }).first()
}

test.describe("국가과제 공고 첨부 상태 @archive", () => {
  // 지키는 것: 첨부 없음(원문 확인 날짜) · 가점이 빈 까닭
  test("첨부 없음 — 원문 확인 날짜와 가점 까닭", async ({ page }) => {
    await login(page, "팀장")
    const row = await open(page, NONE)
    await expect(row.locator("[data-grant-att-status=none]")).toHaveText("첨부 없음 · 원문 확인 2026-11-27")
    await expect(row.locator("[data-grant-bonus-empty]")).toContainText("항목 없음 · 첨부 없음(원문 확인 2026-11-27) · 본문만 봄")
    await expect(row.locator("[data-grant-bonus]")).toHaveCount(0)
  })

  // 지키는 것: 못 읽은 첨부 — 까닭별 수 · 파일 옆 표시 · 가점이 빈 까닭
  test("이미지라 못 읽은 첨부 — 파일 옆 표시와 가점 까닭", async ({ page }) => {
    await login(page, "팀장")
    const row = await open(page, IMAGE)
    await expect(row.locator("[data-grant-att-status=present]")).toHaveText("첨부 2개 · 이미지라 못 읽음 1 · 원문 확인 2026-11-27")
    const files = row.getByRole("link").filter({ hasText: `스캔본${stamp}.pdf` })
    await expect(files.locator("[data-grant-att-unread]")).toHaveText("이미지라 못 읽음")
    await expect(row.getByRole("link").filter({ hasText: `공고문${stamp}.hwp` }).locator("[data-grant-att-unread]")).toHaveCount(0)
    await expect(row.locator("[data-grant-bonus-empty]")).toContainText("항목 없음 · 첨부 2개 중 1개를 읽지 못함")
  })
})

test.describe("국가과제 공고 첨부 상태 폰 @archive @mobile", () => {
  test("폰 — 첨부 상태 줄", async ({ page }) => {
    await login(page, "팀장")
    const row = await open(page, IMAGE)
    await expect(row.locator("[data-grant-att-status=present]")).toBeVisible()
    const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
    expect(sw).toBeLessThanOrEqual(iw)
  })
})
