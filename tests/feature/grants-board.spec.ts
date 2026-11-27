/**
 * 국가과제 「우리 결정」 보드 — 목록/보드 전환, 단계 일곱 열, 끌어 놓아 단계 바꾸기.
 *
 * 지키는 것
 * - 목록은 그대로 있고, 「보드」 를 누르면 주소에 view=board 가 붙고 열이 단계 순서로 놓인다
 * - 카드에 제목 · 마감 · 담당 · 지원금액이 보인다
 * - 카드를 다른 열로 끌어 놓으면 단계가 바뀌고, 다시 열어도 그 열에 있고, 활동 기록이 남는다
 * - 그새 다른 사람이 단계를 바꿨으면(409) 카드가 제자리로 돌아가고 알려 준 뒤 새 단계 열로 간다
 * - 폰에서는 열을 가로로 넘기고, 카드 메뉴로 단계를 바꾼다
 */
import { expect, test, type Locator, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { login } from "./_setup"

const prisma = new PrismaClient()
const stamp = Date.now()
const TITLE = `e2e 보드 과제 ${stamp}`
const PHONE = `e2e 보드 폰 과제 ${stamp}`
const ids: string[] = []

test.beforeAll(async () => {
  const owner = await prisma.user.findFirstOrThrow({ where: { name: "팀장" } })
  for (const title of [TITLE, PHONE]) {
    const d = await prisma.grantDecision.create({
      data: {
        externalKey: `notice:e2e-board-${title === TITLE ? "pc" : "phone"}-${stamp}`,
        title,
        stage: "PREPARING",
        amount: "최대 1억",
        deadline: new Date("2027-03-02T00:00:00+09:00"),
        owners: { create: [{ userId: owner.id }] },
      },
    })
    ids.push(d.id)
  }
})

test.afterAll(async () => {
  await prisma.grantDecision.deleteMany({ where: { id: { in: ids } } })
  await prisma.activityLog.deleteMany({ where: { entityId: { in: ids } } })
  await prisma.$disconnect()
})

const column = (page: Page, stage: string) => page.locator(`[data-grants-column="${stage}"]`)
const card = (page: Page, stage: string, title: string) =>
  column(page, stage).locator("[data-grants-card]").filter({ hasText: title })
const stageOf = async (id: string) => (await prisma.grantDecision.findUniqueOrThrow({ where: { id } })).stage
const stageLogs = (id: string, text: string) =>
  prisma.activityLog
    .findMany({ where: { entityId: id, action: "grant.decision.updated" } })
    .then((rows) => rows.filter((r) => JSON.stringify(r.metadata).includes(text)).length)

/** dnd-kit 마우스 끌기 — 6px 넘게 움직여야 집힌다. 열 가운데에 놓는다 */
async function drag(page: Page, from: Locator, to: Locator) {
  await from.scrollIntoViewIfNeeded()
  const a = (await from.boundingBox())!
  await page.mouse.move(a.x + 30, a.y + 20)
  await page.mouse.down()
  await page.mouse.move(a.x + 40, a.y + 30, { steps: 4 })
  await to.scrollIntoViewIfNeeded()
  const b = (await to.boundingBox())!
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 120), { steps: 12 })
  await page.mouse.up()
}

test.describe("국가과제 보드 @archive", () => {
  test.describe.configure({ mode: "serial" })
  test.slow()

  // 지키는 것: 목록 · 보드 전환, 열 순서, 카드 내용
  test("보드 전환 — 일곱 열 · 카드에 마감 · 담당 · 지원금액", async ({ page }) => {
    await login(page, "팀장")
    await page.goto("/omnis/grants")
    await expect(page.getByRole("button", { name: `${TITLE} 펼치기` })).toBeVisible()
    await page.getByRole("group", { name: "보기" }).getByRole("link", { name: "보드" }).click()
    await expect(page).toHaveURL(/view=board/)
    await expect(page.locator("[data-grants-column]")).toHaveCount(7)
    expect(await page.locator("[data-grants-column]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))).toEqual([
      "준비",
      "제출 완료",
      "선정됨",
      "미선정",
      "수행 중",
      "완료",
      "중단",
    ])
    const c = card(page, "PREPARING", TITLE)
    await expect(c).toBeVisible()
    await expect(c).toContainText("마감 2027-03-02")
    await expect(c).toContainText("팀장")
    await expect(c).toContainText("최대 1억")
    // 목록으로 돌아가도 그대로
    await page.getByRole("group", { name: "보기" }).getByRole("link", { name: "목록" }).click()
    await expect(page.getByRole("button", { name: `${TITLE} 펼치기` })).toBeVisible()
  })

  // 지키는 것: 끌어 놓으면 단계가 바뀌고 남고 활동 기록이 남는다
  test("끌어 놓기 — 준비 → 제출 완료", async ({ page }) => {
    await login(page, "팀장")
    await page.goto("/omnis/grants?view=board")
    const patched = page.waitForResponse((r) => r.url().includes(`/api/grants/decisions/${ids[0]}`) && r.request().method() === "PATCH")
    await drag(page, card(page, "PREPARING", TITLE), column(page, "SUBMITTED"))
    const res = await patched
    expect(res.status()).toBe(200)
    expect(res.request().postDataJSON()).toEqual({ stage: "SUBMITTED", expect: { stage: "PREPARING" } })
    await expect(card(page, "SUBMITTED", TITLE)).toBeVisible()
    await expect(card(page, "PREPARING", TITLE)).toHaveCount(0)
    expect(await stageOf(ids[0])).toBe("SUBMITTED")
    expect(await stageLogs(ids[0], "단계 준비 → 제출 완료")).toBe(1)
    await page.reload()
    await expect(card(page, "SUBMITTED", TITLE)).toBeVisible()
  })

  // 지키는 것: 그새 바뀐 단계면 409 — 제자리로 돌아가고 알려 준 뒤 새 단계 열로
  test("충돌 — 그새 선정됨이 되었으면 미선정으로 옮기지 않는다", async ({ page }) => {
    await login(page, "팀장")
    await page.goto("/omnis/grants?view=board")
    await expect(card(page, "SUBMITTED", TITLE)).toBeVisible()
    await prisma.grantDecision.update({ where: { id: ids[0] }, data: { stage: "SELECTED" } })
    const patched = page.waitForResponse((r) => r.url().includes(`/api/grants/decisions/${ids[0]}`) && r.request().method() === "PATCH")
    await drag(page, card(page, "SUBMITTED", TITLE), column(page, "REJECTED"))
    expect((await patched).status()).toBe(409)
    await expect(page.getByText(/그새 다른 사람이 단계/)).toBeVisible()
    await expect(card(page, "SELECTED", TITLE)).toBeVisible()
    await expect(card(page, "REJECTED", TITLE)).toHaveCount(0)
    expect(await stageOf(ids[0])).toBe("SELECTED")
  })
})

test.describe("국가과제 보드 폰 @archive @mobile", () => {
  // 지키는 것: 폰은 열을 가로로 넘기고, 카드 메뉴로 단계를 바꾼다
  test("가로로 넘기는 열 · 메뉴로 단계 바꾸기", async ({ page }) => {
    test.slow()
    await login(page, "팀장")
    await page.goto("/omnis/grants?view=board")
    const board = page.locator("[data-grants-board]")
    await expect(card(page, "PREPARING", PHONE)).toBeVisible()
    const { scroll, client, pageScroll, pageWidth } = await board.evaluate((el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
      pageScroll: document.documentElement.scrollWidth,
      pageWidth: window.innerWidth,
    }))
    expect(scroll).toBeGreaterThan(client * 3)
    expect(pageScroll).toBeLessThanOrEqual(pageWidth)
    // 마지막 열(중단)은 처음엔 화면 밖 — 넘기면 보인다
    await expect(column(page, "STOPPED")).not.toBeInViewport()
    await board.evaluate((el) => el.scrollTo({ left: el.scrollWidth }))
    await expect(column(page, "STOPPED")).toBeInViewport()
    await board.evaluate((el) => el.scrollTo({ left: 0 }))

    await card(page, "PREPARING", PHONE).getByRole("button", { name: `${PHONE} 단계 바꾸기` }).click()
    const patched = page.waitForResponse((r) => r.url().includes(`/api/grants/decisions/${ids[1]}`) && r.request().method() === "PATCH")
    await page.getByRole("menuitem", { name: "수행 중" }).click()
    expect((await patched).status()).toBe(200)
    await expect(card(page, "IN_PROGRESS", PHONE)).toBeAttached()
    expect(await stageOf(ids[1])).toBe("IN_PROGRESS")
    expect(await stageLogs(ids[1], "단계 준비 → 수행 중")).toBe(1)
  })
})
