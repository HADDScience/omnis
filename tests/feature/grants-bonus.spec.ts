/**
 * 국가과제 공고 가점 × 우리 인증 — 공고에서 뽑아 둔 가점 항목을 우리 인증과 맞춘 표.
 *
 * 지키는 것
 * - 과제 후보 공고를 펼치면 가점 표가 보인다: 항목 · 점수 · 우리 상태(보유 · 유효기간 안 · 만료 · 없음) · 근거(원문)
 * - 이름이 다른 같은 인증을 맞춘다(공고 「벤처인증 기업」 = 우리 「벤처기업 확인」)
 * - 예상 가점은 보유 · 유효기간 안 항목만 더하고, 상한을 넘지 않는다
 * - 우리 결정 펼침에도 이어진 공고의 같은 표가 보인다
 * - 폰에서는 표가 줄마다 쌓이고 화면 밖으로 넘치지 않는다
 */
import { expect, test, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { login } from "./_setup"

const prisma = new PrismaClient()
const stamp = Date.now()
const NOTICE = `e2e 가점 공고 ${stamp}`
const KEY = `notice:e2e:bonus-${stamp}`
const certKeys = [`cert:e2e-venture-${stamp}`, `cert:e2e-women-${stamp}`, `cert:e2e-inno-${stamp}`]
let noticeId = ""
let decisionId = ""

test.beforeAll(async () => {
  const n = await prisma.grantNotice.create({
    data: {
      externalKey: KEY,
      title: NOTICE,
      deadlineAt: new Date(Date.now() + 20 * 86_400_000),
      verdictSole: "해당",
      verdictCorp: "해당",
      judgedBy: "rules",
      regionDetail: [],
      fields: [],
      bonusStatus: "ok",
      bonusModel: "openai:gpt-6.1-sol",
      bonusExtractedAt: new Date(),
      bonusItems: [
        { label: "벤처인증 기업", points: 2, pointsText: "2점", condition: null, quote: "벤처인증 기업</td><td>2점", source: "첨부: 공고문.hwp" },
        { label: "여성기업", points: 1, pointsText: "1점", condition: "대표자 기준", quote: "여성기업 1점", source: "본문(e2e)" },
        { label: "이노비즈 인증 기업", points: 1, pointsText: "1점", condition: null, quote: "이노비즈 인증 기업 1점", source: "본문(e2e)" },
      ],
      bonusCap: { points: 2.5, text: "최대 2.5점", quote: "가점은 최대 2.5점" },
    },
  })
  noticeId = n.id
  await prisma.companyCertification.createMany({
    data: [
      { externalKey: certKeys[0], name: `벤처기업 확인 e2e${stamp}`, status: "HELD", validUntil: new Date("2099-01-01T00:00:00+09:00") },
      { externalKey: certKeys[1], name: `여성기업 확인 e2e${stamp}`, status: "EXPIRED", validUntil: new Date("2020-01-01T00:00:00+09:00") },
      { externalKey: certKeys[2], name: `이노비즈 e2e${stamp}`, status: "NOT_ELIGIBLE" },
    ],
  })
  const d = await prisma.grantDecision.create({ data: { externalKey: KEY, title: `e2e 가점 결정 ${stamp}`, stage: "PREPARING" } })
  decisionId = d.id
})

test.afterAll(async () => {
  await prisma.grantDecision.deleteMany({ where: { id: decisionId } })
  await prisma.grantNotice.deleteMany({ where: { id: noticeId } })
  await prisma.companyCertification.deleteMany({ where: { externalKey: { in: certKeys } } })
  await prisma.$disconnect()
})

async function openNotice(page: Page) {
  await page.goto(`/omnis/grants?tab=notices&q=${encodeURIComponent(String(stamp))}`)
  await page.getByRole("button", { name: `${NOTICE} 펼치기` }).click()
  const table = page.locator("[data-grant-bonus]")
  await expect(table).toBeVisible()
  return table
}

test.describe("국가과제 공고 가점 @archive", () => {
  test.slow()

  // 지키는 것: 공고 펼침의 표 — 이름이 다른 같은 인증 맞추기, 우리 상태, 근거 원문, 예상 합계(상한)
  test("과제 후보 공고 — 가점 표와 예상 합계", async ({ page }) => {
    await login(page, "팀장")
    const table = await openNotice(page)
    const rows = table.locator("tbody tr")
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(0)).toContainText("벤처인증 기업")
    await expect(rows.nth(0)).toContainText("유효기간 안")
    await expect(rows.nth(0)).toContainText(`벤처기업 확인 e2e${stamp}`)
    await expect(rows.nth(0)).toContainText("~ 2099-01-01")
    // 근거는 원문에서 표 태그만 걷어 보인다
    await expect(rows.nth(0)).toContainText("벤처인증 기업 · 2점")
    await expect(rows.nth(0)).toContainText("첨부: 공고문.hwp")
    await expect(rows.nth(1)).toContainText("만료")
    await expect(rows.nth(1)).toContainText("대표자 기준")
    await expect(rows.nth(2)).toContainText("없음")
    await expect(rows.nth(2)).toContainText("자격 안 됨")
    // 받는 것은 벤처 2점뿐(여성기업은 만료), 최대는 4점이지만 상한 2.5점
    await expect(table.locator("[data-grant-bonus-total]")).toHaveText(/예상 2점\s*\/ 최대 2.5점 · 상한 최대 2.5점/)
    await expect(table.getByRole("columnheader")).toHaveText(["가점 항목", "점수", "우리 상태", "근거"])
  })

  // 지키는 것: 우리 결정 펼침에도 이어진 공고의 같은 표
  test("우리 결정 펼침 — 이어진 공고의 가점 표", async ({ page }) => {
    await login(page, "팀장")
    await page.goto("/omnis/grants")
    await page.getByRole("button", { name: `e2e 가점 결정 ${stamp} 펼치기` }).click()
    const table = page.locator("[data-grant-bonus]")
    await expect(table).toBeVisible()
    await expect(table).toContainText(NOTICE)
    await expect(table.locator("tbody tr")).toHaveCount(3)
    await expect(table.locator("[data-grant-bonus-total]")).toContainText("예상 2점")
  })
})

test.describe("국가과제 공고 가점 폰 @archive @mobile", () => {
  // 지키는 것: 폰에서는 머리 줄 없이 줄마다 쌓이고 화면 밖으로 넘치지 않는다
  test("폰 — 줄마다 쌓인 표", async ({ page }) => {
    test.slow()
    await login(page, "팀장")
    const table = await openNotice(page)
    await expect(table.locator("thead")).toBeHidden()
    await expect(table.locator("tbody tr").first()).toContainText("유효기간 안")
    const { page: pw, inner } = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, inner: window.innerWidth }))
    expect(pw).toBeLessThanOrEqual(inner)
    const box = (await table.boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(390)
  })
})
