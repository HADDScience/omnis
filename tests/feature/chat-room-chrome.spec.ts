/**
 * 폰의 전사 · 사람 방은 글이 머리 · 입력창 뒤로 지나간다. 첫 글 · 끝 글은 가리지 않고, 맨 아래 고정 · 앞 글 불러오기 · 검색 이동 ·
 * 새 글 단추 · 키보드가 그대로 돈다. PC · 업무 · 옴니스 방은 그대로다. 방을 시험 DB 에 넣는다 — 로컬 DB 에서만 돈다.
 */
import { randomUUID } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { login } from "./_setup"

const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")
test.skip(!LOCAL_DB, "시험 DB 를 직접 고친다")
test.describe.configure({ mode: "serial" })

const prisma = LOCAL_DB ? new PrismaClient() : (null as unknown as PrismaClient)
const roomId = randomUUID()
const TOTAL = 60
let peer = ""

test.beforeAll(async () => {
  const me = await prisma.user.findFirstOrThrow({ where: { name: "팀장" } })
  peer = (await prisma.user.findFirstOrThrow({ where: { name: "사원1" } })).id
  await prisma.chatRoom.create({ data: { id: roomId, name: "뒤로 지나가기 시험", kind: "GROUP", createdById: me.id, lastMessageAt: new Date(), members: { create: [{ userId: me.id }, { userId: peer }] } } })
  const base = Date.now() - (TOTAL + 2) * 120_000
  await prisma.chatMessage.createMany({
    data: Array.from({ length: TOTAL }, (_, i) => ({ roomId, authorId: i % 3 ? peer : me.id, content: `지나가기 글 ${i}`, createdAt: new Date(base + i * 120_000), changedAt: new Date(base + i * 120_000) })),
  })
})
test.afterAll(async () => {
  await prisma?.$disconnect()
})

const LIST = "section [data-keep-bottom]"
const PILL = "section [data-composer-pill]"
const HEADER = "section [data-room-header]"
const rect = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height }
  })
const rowRect = (page: Page, text: string) =>
  page.locator("section [data-message-body]", { hasText: new RegExp(`${text}$`) }).first().evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { top: r.top, bottom: r.bottom }
  })
const fromBottom = (page: Page) => page.locator(LIST).first().evaluate((el) => Math.round(el.scrollHeight - el.clientHeight - el.scrollTop))

async function openRoom(page: Page) {
  await login(page, "팀장")
  await page.goto(`/chat/${roomId}`)
  await page.locator("section [data-message-id]").first().waitFor({ timeout: 30_000 })
  await expect.poll(() => page.locator(`${PILL} textarea`).first().evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))), { timeout: 30_000 }).toBe(true)
  await page.waitForTimeout(300)
}

for (const width of [390, 402]) {
  test.describe(`폰 ${width}px`, () => {
    test.use({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true })

    test("글 칸이 위아래 끝까지 닿고, 끝 글은 입력창 위 · 글은 머리 뒤로 지나간다", async ({ page }) => {
      await openRoom(page)
      const list = await rect(page, LIST)
      // 데모 빌드는 맨 위에 배너가 있다
      expect(list.top).toBe((await rect(page, "[data-main-scroll]")).top)
      expect(Math.round(list.bottom)).toBe(844)
      await expect.poll(() => fromBottom(page)).toBeLessThanOrEqual(1)
      const last = await rowRect(page, `지나가기 글 ${TOTAL - 1}`)
      const pill = await rect(page, PILL)
      expect(last.bottom).toBeLessThanOrEqual(pill.top)
      const nav = await rect(page, 'nav[aria-label="주 메뉴"]:visible')
      expect(pill.bottom).toBeLessThanOrEqual(nav.top)
      // 머리 뒤 · 입력창 뒤에 글이 있다
      const header = await rect(page, HEADER)
      const counts = await page.locator("section [data-message-id]").evaluateAll(
        (rows, { top, bottom }) => ({
          behindHeader: rows.filter((r) => { const b = r.getBoundingClientRect(); return b.top < top && b.bottom > 0 }).length,
          shown: rows.filter((r) => { const b = r.getBoundingClientRect(); return b.bottom < bottom && b.top > top }).length,
        }),
        { top: header.bottom, bottom: pill.top },
      )
      expect(counts.behindHeader).toBeGreaterThan(0)
      expect(counts.shown).toBeGreaterThan(3)
    })

    test("날짜 구분은 가운데 알약이다", async ({ page }) => {
      await openRoom(page)
      const pill = page.locator("section [role=separator] span:visible").first()
      expect((await pill.boundingBox())!.height).toBe(26)
      expect(await pill.evaluate((el) => getComputedStyle(el).fontSize)).toBe("13px")
    })

    test("맨 위로 올리면 앞 글을 받아도 보던 자리에 있고, 첫 글은 머리에 가리지 않는다", async ({ page }) => {
      await openRoom(page)
      const list = page.locator(LIST).first()
      const before = await page.locator("section [data-message-id]").count()
      const firstText = await page.locator("section [data-message-id] [data-message-body]").first().innerText()
      await list.evaluate((el) => {
        el.scrollTop = 0
      })
      await expect.poll(() => page.locator("section [data-message-id]").count(), { timeout: 10_000 }).toBeGreaterThan(before)
      await page.waitForTimeout(200)
      // 받기 전 맨 앞 글이 화면 밖으로 튀지 않는다
      const anchor = await page.locator("section [data-message-body]", { hasText: firstText }).first().evaluate((el) => el.getBoundingClientRect().top)
      expect(anchor).toBeGreaterThan(0)
      expect(anchor).toBeLessThan(844)
      await list.evaluate((el) => {
        el.scrollTop = 0
      })
      await page.waitForTimeout(800)
      await list.evaluate((el) => {
        el.scrollTop = 0
      })
      await page.waitForTimeout(300)
      const top = await page.locator("section [data-message-body]").first().evaluate((el) => el.getBoundingClientRect().top)
      expect(top).toBeGreaterThanOrEqual((await rect(page, HEADER)).bottom)
    })

    test("입력창이 여러 줄로 늘어도 끝 글이 가리지 않고, 줄면 돌아온다", async ({ page }) => {
      await openRoom(page)
      await expect.poll(() => fromBottom(page)).toBeLessThanOrEqual(1)
      const box = page.locator(`${PILL} textarea`).first()
      const start = (await rect(page, PILL)).h
      await box.fill("한 줄\n두 줄\n세 줄\n네 줄")
      await expect.poll(async () => (await rect(page, PILL)).h).toBeGreaterThan(start + 30)
      await expect.poll(() => fromBottom(page)).toBeLessThanOrEqual(1)
      expect((await rowRect(page, `지나가기 글 ${TOTAL - 1}`)).bottom).toBeLessThanOrEqual((await rect(page, PILL)).top)
      await box.fill("")
      await expect.poll(async () => (await rect(page, PILL)).h).toBe(start)
      await expect.poll(() => fromBottom(page)).toBeLessThanOrEqual(1)
    })

    test("위로 올려 읽는 중 새 글 — 단추가 입력창 위에 뜨고, 눌러 맨 아래로 간다", async ({ page }) => {
      await openRoom(page)
      await page.locator(LIST).first().evaluate((el) => {
        el.scrollTop = el.scrollHeight / 3
      })
      await page.waitForTimeout(300)
      const text = `새 글 ${Date.now()}`
      await prisma.chatMessage.create({ data: { roomId, authorId: peer, content: text, createdAt: new Date(), changedAt: new Date() } })
      const pill = page.getByRole("button", { name: /새 메시지/ })
      await pill.waitFor({ timeout: 10_000 })
      expect((await pill.boundingBox())!.y + (await pill.boundingBox())!.height).toBeLessThanOrEqual((await rect(page, PILL)).top)
      await pill.click()
      await expect.poll(() => fromBottom(page), { timeout: 5_000 }).toBeLessThanOrEqual(1)
      expect((await rowRect(page, text)).bottom).toBeLessThanOrEqual((await rect(page, PILL)).top)
    })

    test("검색 결과는 머리와 입력창 사이에 오고, 검색 줄은 머리 아래에 뜬다", async ({ page }) => {
      await openRoom(page)
      const toggle = page.getByRole("button", { name: "채팅 검색" })
      await toggle.click()
      const input = page.getByRole("searchbox", { name: "채팅 검색어" })
      await input.waitFor()
      const header = await rect(page, HEADER)
      const bar = await input.boundingBox()
      expect(bar!.y).toBeGreaterThanOrEqual(header.bottom - 1)
      await input.fill("지나가기 글 5")
      // 가장 최근 결과가 먼저다 — 그 글이 머리 · 검색 줄 아래, 입력창 위에 있다
      await expect.poll(async () => {
        const row = await rowRect(page, "지나가기 글 59").catch(() => null)
        const pill = await rect(page, PILL)
        const barNow = await input.boundingBox()
        return !!row && row.top >= barNow!.y + barNow!.height && row.bottom <= pill.top
      }, { timeout: 15_000 }).toBe(true)
    })

    test("키보드가 뜨면 입력창이 키보드 바로 위 · 좌우 10 · 끝 글이 보인다", async ({ page }) => {
      await page.addInitScript(() => {
        const fake = new EventTarget() as EventTarget & Record<string, unknown>
        let height: number | null = null
        Object.defineProperties(fake, {
          height: { get: () => height ?? window.innerHeight },
          width: { get: () => window.innerWidth },
          scale: { value: 1 },
          offsetTop: { value: 0 },
          offsetLeft: { value: 0 },
        })
        Object.defineProperty(window, "visualViewport", { value: fake, configurable: true })
        ;(window as unknown as { __keyboard: (h: number | null) => void }).__keyboard = (h) => {
          height = h
          fake.dispatchEvent(new Event("resize"))
        }
      })
      await openRoom(page)
      await expect.poll(() => fromBottom(page)).toBeLessThanOrEqual(1)
      await page.locator(`${PILL} textarea`).first().tap()
      await page.evaluate(() => (window as unknown as { __keyboard: (h: number) => void }).__keyboard(450))
      await expect.poll(() => page.evaluate(() => document.documentElement.hasAttribute("data-keyboard-docked"))).toBe(true)
      await expect.poll(async () => (await rect(page, PILL)).bottom).toBeLessThanOrEqual(450)
      const pill = await rect(page, PILL)
      expect(450 - pill.bottom).toBeLessThanOrEqual(8)
      expect(Math.round(pill.left)).toBe(10)
      await expect.poll(() => fromBottom(page)).toBeLessThanOrEqual(1)
      const lastBubble = await page.locator("section [data-message-body]").last().evaluate((el) => el.getBoundingClientRect().bottom)
      expect(lastBubble).toBeLessThanOrEqual(pill.top)
      await page.evaluate(() => (window as unknown as { __keyboard: (h: number | null) => void }).__keyboard(null))
      await expect.poll(() => page.evaluate(() => document.documentElement.hasAttribute("data-keyboard-docked"))).toBe(false)
      await expect.poll(async () => Math.round((await rect(page, PILL)).left)).toBe(20)
    })

    test("업무 · 옴니스 방은 머리와 입력창이 뜨지 않는다", async ({ page }) => {
      await login(page, "팀장")
      const data = (await (await page.request.get("/api/tasks")).json()) as { id: string }[] | { tasks: { id: string }[] }
      const task = (Array.isArray(data) ? data : data.tasks)[0].id
      for (const url of [`/chat/task/${task}`, "/chat/new"]) {
        await page.goto(url)
        await page.locator(PILL).first().waitFor({ timeout: 30_000 })
        await expect(page.locator(HEADER).first(), url).not.toHaveCSS("position", "absolute")
        expect(await page.locator("[data-main-scroll]").evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom)), url).toBeGreaterThanOrEqual(68)
      }
    })
  })
}

test.describe("PC", () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test("머리 · 입력창이 글 칸 밖에 그대로 있다", async ({ page }) => {
    await openRoom(page)
    await expect(page.locator(HEADER).first()).not.toHaveCSS("position", "absolute")
    await expect(page.locator("[data-room-composer-chrome]").first()).not.toHaveCSS("position", "absolute")
    const list = await rect(page, LIST)
    expect(list.top).toBeGreaterThanOrEqual((await rect(page, HEADER)).bottom - 1)
    expect(list.bottom).toBeLessThanOrEqual((await rect(page, PILL)).top)
  })
})
