/**
 * 폰의 채팅 목록은 유리 nav 뒤로 지나간다. 맨 아래 방은 끝 여백 덕에 가리지 않고, 대화방 · PC 는 그대로다.
 * 방을 시험 DB 에 직접 넣는다 — 로컬 DB(CI · e2e-local)에서만 돈다.
 */
import { randomUUID } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { login } from "./_setup"

const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")
test.skip(!LOCAL_DB, "시험 DB 를 직접 고친다")
test.describe.configure({ mode: "serial" })

const prisma = LOCAL_DB ? new PrismaClient() : (null as unknown as PrismaClient)
const rooms: string[] = []

test.beforeAll(async () => {
  const me = await prisma.user.findFirstOrThrow({ where: { name: "팀장" } })
  const peer = await prisma.user.findFirstOrThrow({ where: { name: "사원1" } })
  // 맨 처음 넣은 방이 목록 맨 아래로 간다 — 최근 글이 가장 오래된 방
  for (let i = 0; i < 16; i++) {
    const id = randomUUID()
    const at = new Date(Date.now() - (16 - i) * 60_000 - 86_400_000 * 400)
    await prisma.chatRoom.create({
      data: { id, name: `목록 시험 ${i}`, kind: "GROUP", createdById: me.id, createdAt: at, lastMessageAt: at, members: { create: [{ userId: me.id }, { userId: peer.id }] } },
    })
    await prisma.chatMessage.create({ data: { roomId: id, authorId: peer.id, content: `목록 시험 글 ${i}`, createdAt: at, changedAt: at } })
    rooms.push(id)
  }
})

test.afterAll(async () => {
  await prisma?.$disconnect()
})

const MAIN = "[data-main-scroll]"
const LIST = 'nav[aria-label="채팅방"]'
const BOTTOM_NAV = 'nav[aria-label="주 메뉴"]'
const rect = (page: Page, selector: string) =>
  page.locator(selector).last().evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }
  })
const rowOf = (roomId: string) => `aside a[href="/chat/${roomId}"]`

async function openList(page: Page) {
  await login(page, "팀장")
  await page.goto("/chat")
  await page.locator(rowOf(rooms[0])).waitFor({ state: "attached", timeout: 30_000 })
}

test.describe("폰", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test("목록 칸이 화면 끝까지 닿고, 스크롤 중 방이 nav 뒤로 지나간다", async ({ page }) => {
    await openList(page)
    expect(await page.locator(MAIN).evaluate((el) => getComputedStyle(el).paddingBottom)).toBe("0px")
    const list = await rect(page, LIST)
    expect(Math.round(list.bottom)).toBe(844)

    const nav = await rect(page, BOTTOM_NAV)
    const behind = await page.locator(`${LIST} a[href^="/chat/"]`).evaluateAll(
      (rows, top) => rows.filter((row) => { const r = row.getBoundingClientRect(); return r.bottom > top && r.top < innerHeight }).length,
      nav.top,
    )
    expect(behind).toBeGreaterThan(0)
    // 띠가 옅다 — 유리 너머가 보인다
    expect(await page.locator(".nav-edge-bottom").evaluate((el) => getComputedStyle(el).backdropFilter)).toBe("none")
  })

  test("맨 끝까지 내리면 맨 아래 방이 nav 에 가리지 않고 FAB 는 없다", async ({ page }) => {
    await openList(page)
    const list = page.locator(LIST)
    await list.evaluate((el) => {
      el.style.scrollSnapType = "none"
      el.scrollTop = el.scrollHeight
    })
    await page.waitForTimeout(200)
    const row = await rect(page, rowOf(rooms[0]))
    const nav = await rect(page, BOTTOM_NAV)
    expect(row.bottom).toBeLessThanOrEqual(nav.top)
    await expect(page.locator("[data-new-chat-fab]")).toBeHidden()
  })

  test("목록 줄 · 사진 · 칩 크기가 목표 값이다", async ({ page }) => {
    await openList(page)
    const g = await page.locator(rowOf(rooms[15])).evaluate((el) => {
      const icon = el.querySelector("span[aria-hidden]")!.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      return { h: Math.round(r.height), icon: icon.width, left: icon.left - r.left }
    })
    expect(g).toEqual({ h: 66, icon: 47, left: 16 })
    const chip = page.getByRole("button", { name: "전체" }).first()
    expect((await chip.boundingBox())!.height).toBe(37)
  })

  test("칩 줄은 위에 남고 새 대화 메뉴가 열린다", async ({ page }) => {
    await openList(page)
    await page.locator(LIST).evaluate((el) => {
      el.scrollTop = 400
    })
    const chips = await rect(page, 'aside [role="tablist"], aside [aria-label*="칩"], aside > div > div:first-child')
    expect(chips.top).toBeLessThan(120)
    const fab = page.locator("[data-new-chat-title]")
    await expect.poll(() => fab.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))), { timeout: 30_000 }).toBe(true)
    await fab.click()
    await expect(page.getByRole("menuitem", { name: /옴니스와 대화/ })).toBeVisible()
  })

  test("방을 열면 nav 가 사라지고, 돌아오면 다시 보이며 목록이 다시 닿는다", async ({ page }) => {
    await openList(page)
    await expect(page.locator(BOTTOM_NAV).last()).toBeVisible()
    const row = page.locator(rowOf(rooms[15]))
    await row.scrollIntoViewIfNeeded()
    await expect.poll(() => row.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))), { timeout: 30_000 }).toBe(true)
    await row.tap()
    await page.waitForURL(`**/chat/${rooms[15]}`)
    const main = page.locator(MAIN)
    await page.locator("section [data-composer-pill]").first().waitFor({ timeout: 15_000 })
    await expect(page.locator(`${BOTTOM_NAV}:visible`)).toHaveCount(0)
    await expect(page.locator(".nav-edge-bottom")).toBeHidden()

    await page.goBack()
    await expect(page.locator(BOTTOM_NAV).last()).toBeVisible()
    await expect.poll(() => main.evaluate((el) => getComputedStyle(el).paddingBottom)).toBe("0px")
  })

  test("다른 화면은 nav 자리를 그대로 비운다", async ({ page }) => {
    await login(page, "팀장")
    for (const url of ["/tasks", "/calendar"]) {
      await page.goto(url)
      const main = page.locator(MAIN)
      await main.waitFor({ timeout: 30_000 })
      expect(await main.evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom)), url).toBeGreaterThanOrEqual(68)
      expect(await page.locator(".nav-edge-bottom").evaluate((el) => getComputedStyle(el).backdropFilter), url).not.toBe("none")
    }
  })
})

test.describe("PC", () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test("목록 칸과 새 대화 단추 자리는 그대로다", async ({ page }) => {
    await openList(page)
    expect(await page.locator(MAIN).evaluate((el) => getComputedStyle(el).paddingBottom)).toBe("0px")
    const aside = await rect(page, 'aside[aria-label="채팅방 목록"]')
    const fab = await rect(page, "[data-new-chat-fab]")
    // 데모 배너 · 화면 배율이 몇 px 를 먹는다
    expect(aside.bottom).toBeGreaterThan(880)
    // bottom-4 = 1rem(화면 배율 1.1 이 곱해진 값)
    expect(aside.bottom - fab.bottom).toBeGreaterThan(10)
    expect(aside.bottom - fab.bottom).toBeLessThan(24)
  })
})
