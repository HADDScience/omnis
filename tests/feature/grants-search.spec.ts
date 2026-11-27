/**
 * 아카이브 › 국가과제 검색 — 우리 결정 · 과제 후보, 목록 · 보드 모두 같은 검색 칸.
 *
 * 지키는 것
 * - 칸에 쓰면 잠시 뒤 주소가 ?q= 로 바뀌고 서버가 찾은 것만 보인다. 칸 오른쪽에 건수
 * - 띄어쓰기를 무시하고 부분 일치, 여러 낱말은 모두 들어 있어야 한다
 * - 메모 · 담당 · 첨부 파일 이름 · 가점 항목 · 판정 근거(본문 요약)로도 찾는다. 결정은 이어진 공고의 글로도, 공고는 올린 결정의 글로도
 * - 단계 칩 · 보기 전환 · 탭을 옮겨도 찾는 말이 남는다. 주소를 그대로 열면 같은 결과(공유)
 * - 폰에서도 같은 칸
 */
import { expect, test, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { login } from "./_setup"

const prisma = new PrismaClient()
const stamp = Date.now()
const KEY = `notice:e2e:search-${stamp}`
const NOTICE = `e2e 검색 공고 ${stamp}`
const DECISION = `e2e 검색 결정 ${stamp}`
const OTHER = `e2e 검색 다른 결정 ${stamp}`
const ids: { notice?: string; decisions: string[] } = { decisions: [] }

test.beforeAll(async () => {
  const owner = await prisma.user.findFirstOrThrow({ where: { name: "팀장" } })
  const n = await prisma.grantNotice.create({
    data: {
      externalKey: KEY,
      title: NOTICE,
      ministry: "가상부",
      agency: `가상진흥원${stamp}`,
      deadlineAt: new Date(Date.now() + 20 * 86_400_000),
      verdictSole: "해당",
      verdictCorp: "해당",
      judgedBy: "rules",
      regionDetail: [],
      fields: [],
      reasonsSole: [{ claim: `요약문장${stamp} 바이오 소재 실증`, quote: "원문" }],
      attachments: [{ name: `공고문_첨부${stamp}.hwp`, type: "HWP", size: 1000, url: "https://example.invalid/a" }],
      bonusStatus: "ok",
      bonusItems: [{ label: `가점항목${stamp} 인증기업`, points: 1, pointsText: "1점", condition: null, quote: "가점 1점", source: "본문" }],
    },
  })
  ids.notice = n.id
  const d = await prisma.grantDecision.create({
    data: {
      externalKey: KEY,
      title: DECISION,
      stage: "PREPARING",
      note: `메모 내용 ${stamp} 협약 준비`,
      owners: { create: [{ userId: owner.id }] },
    },
  })
  const o = await prisma.grantDecision.create({
    data: { externalKey: `notion:e2e-search-${stamp}`, title: OTHER, stage: "SUBMITTED", stageReason: `사유 ${stamp}` },
  })
  ids.decisions.push(d.id, o.id)
})

test.afterAll(async () => {
  await prisma.grantDecision.deleteMany({ where: { id: { in: ids.decisions } } })
  if (ids.notice) await prisma.grantNotice.deleteMany({ where: { id: ids.notice } })
  await prisma.$disconnect()
})

const box = (page: Page) => page.getByRole("searchbox", { name: "국가과제 검색" })
const count = (page: Page) => page.locator("[data-grants-search-count]")

/** 쓰고 주소가 바뀔 때까지(입력 지연) 기다린다 */
async function search(page: Page, text: string) {
  await box(page).fill(text)
  await expect.poll(() => new URL(page.url()).searchParams.get("q"), { timeout: 10_000 }).toBe(text.trim())
}

test.describe("국가과제 검색 @archive", () => {
  test.slow()

  // 지키는 것: 우리 결정 목록 — 메모 · 띄어쓰기 무시 · AND · 건수 · 단계 칩이 찾는 말을 지킨다
  test("우리 결정 — 메모로 찾기 · 띄어쓰기 무시 · 여러 낱말 · 단계 칩", async ({ page }) => {
    await login(page, "팀장")
    await page.goto("/omnis/grants")
    await search(page, `메모내용${stamp}`)
    await expect(page.getByRole("button", { name: `${DECISION} 펼치기` })).toBeVisible()
    await expect(page.getByRole("button", { name: `${OTHER} 펼치기` })).toHaveCount(0)
    await expect(count(page)).toHaveText("1건")
    // 여러 낱말은 모두 — 하나라도 없으면 0건
    await search(page, `${stamp} 협약`)
    await expect(count(page)).toHaveText("1건")
    await search(page, `${stamp} 협약 없는말`)
    await expect(count(page)).toHaveText("0건")
    // 사유 · 담당 이름으로도
    await search(page, `사유 ${stamp}`)
    await expect(page.getByRole("button", { name: `${OTHER} 펼치기` })).toBeVisible()
    await search(page, `${stamp}`)
    await expect(count(page)).toHaveText("2건")
    // 단계 칩을 눌러도 찾는 말이 남는다
    await page.getByRole("link", { name: /^제출 완료/ }).click()
    await expect(page).toHaveURL(/stage=SUBMITTED/)
    expect(new URL(page.url()).searchParams.get("q")).toBe(String(stamp))
    await expect(count(page)).toHaveText("1건")
    await expect(box(page)).toHaveValue(String(stamp))
  })

  // 지키는 것: 결정은 이어진 공고의 글(첨부 이름 · 가점 항목 · 판정 근거)로도 찾는다 · 보드에서도 같은 칸
  test("보드 · 이어진 공고의 글로 결정 찾기", async ({ page }) => {
    await login(page, "팀장")
    await page.goto(`/omnis/grants?view=board&q=${encodeURIComponent(`첨부${stamp}`)}`)
    await expect(box(page)).toHaveValue(`첨부${stamp}`)
    await expect(count(page)).toHaveText("1건")
    await expect(page.locator("[data-grants-card]").filter({ hasText: DECISION })).toBeVisible()
    await search(page, `가점항목${stamp}`)
    await expect(count(page)).toHaveText("1건")
    await search(page, `요약문장${stamp} 바이오`)
    await expect(count(page)).toHaveText("1건")
    // 목록으로 바꿔도 찾는 말이 남는다
    await page.getByRole("group", { name: "보기" }).getByRole("link", { name: "목록" }).click()
    await expect(page.getByRole("button", { name: `${DECISION} 펼치기` })).toBeVisible()
    expect(new URL(page.url()).searchParams.get("q")).toBe(`요약문장${stamp} 바이오`)
  })

  // 지키는 것: 과제 후보 — 기관 · 첨부 · 결정 메모로 찾기, 마감 필터와 함께, 탭을 옮겨도 남고 주소로 공유된다
  test("과제 후보 — 기관 · 첨부 · 올린 결정의 메모 · 필터와 함께", async ({ page }) => {
    await login(page, "팀장")
    await page.goto("/omnis/grants?tab=notices")
    await search(page, `가상 진흥원${stamp}`)
    await expect(page.getByRole("button", { name: `${NOTICE} 펼치기` })).toBeVisible()
    await expect(count(page)).toHaveText("1건")
    await search(page, `공고문_첨부${stamp}`)
    await expect(count(page)).toHaveText("1건")
    // 공고는 올린 결정의 메모로도
    await search(page, `메모 내용 ${stamp}`)
    await expect(count(page)).toHaveText("1건")
    // 마감 필터 「7일 안」 — 20일 뒤 마감이라 빠진다, 찾는 말은 남는다
    await page.getByRole("link", { name: "7일 안" }).click()
    await expect(count(page)).toHaveText("0건")
    expect(new URL(page.url()).searchParams.get("q")).toBe(`메모 내용 ${stamp}`)
    // 탭을 옮겨도 찾는 말이 남는다
    await page.getByRole("link", { name: /^우리 결정/ }).click()
    await expect(box(page)).toHaveValue(`메모 내용 ${stamp}`)
    await expect(count(page)).toHaveText("1건")
  })
})

test.describe("국가과제 검색 폰 @archive @mobile", () => {
  // 지키는 것: 폰에서도 같은 칸 — 쓰면 찾고, 칸이 화면 밖으로 넘치지 않는다
  test("폰 — 검색 칸", async ({ page }) => {
    test.slow()
    await login(page, "팀장")
    await page.goto("/omnis/grants?tab=notices")
    await expect(box(page)).toBeVisible()
    await search(page, `첨부${stamp}`)
    await expect(page.getByRole("button", { name: `${NOTICE} 펼치기` })).toBeVisible()
    await expect(count(page)).toHaveText("1건")
    const b = (await page.locator("[data-grants-search]").boundingBox())!
    expect(b.x).toBeGreaterThanOrEqual(0)
    expect(b.x + b.width).toBeLessThanOrEqual(390)
    const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
    expect(sw).toBeLessThanOrEqual(iw)
  })
})
