/**
 * 폰의 전사 · 사람 방 비율(2026-11-05). 값은 402px 폭 기준이다. PC · 업무 · 옴니스 방의 말풍선과 머리줄은 그대로다.
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
const roomId = randomUUID()
const LONG = "길게 쓴 글이 말풍선 폭의 상한에서 줄이 바뀌는지 보려고 일부러 여러 낱말을 이어 붙인 문장입니다"

test.beforeAll(async () => {
  const me = await prisma.user.findFirstOrThrow({ where: { name: "팀장" } })
  const a = await prisma.user.findFirstOrThrow({ where: { name: "사원1" } })
  await prisma.chatRoom.create({ data: { id: roomId, name: "비율 시험", kind: "GROUP", createdById: me.id, lastMessageAt: new Date(), members: { create: [{ userId: me.id }, { userId: a.id }] } } })
  const base = Date.now() - 600_000
  const lines: [string, string, number][] = [
    [a.id, "첫 글", 0], [a.id, "이어 쓴 글", 10_000], [me.id, "내 글", 120_000], [a.id, LONG, 240_000], [me.id, LONG, 360_000],
  ]
  for (const [authorId, content, at] of lines) {
    await prisma.chatMessage.create({ data: { roomId, authorId, content, createdAt: new Date(base + at), changedAt: new Date(base + at) } })
  }
})
test.afterAll(async () => {
  await prisma?.$disconnect()
})

const ready = async (page: Page) => {
  await login(page, "팀장")
  await page.goto(`/chat/${roomId}`)
  await page.locator("section [data-message-id] [data-message-body]").first().waitFor({ timeout: 30_000 })
}
const row = (page: Page, text: string) => page.locator("section [data-message-id]", { hasText: text }).first()
const box = (page: Page, text: string) =>
  row(page, text).evaluate((el) => {
    // 말풍선은 글 칸이다 — 사진 · 파일은 그 아래 따로 놓인다
    const r = el.querySelector("[data-message-body] > p")!.getBoundingClientRect()
    const cs = getComputedStyle(el.querySelector("[data-message-body] > p")!)
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height, font: cs.fontSize, padX: cs.paddingLeft, radius: cs.borderTopLeftRadius, rowTop: el.getBoundingClientRect().top, rowBottom: el.getBoundingClientRect().bottom }
  })

test.describe("폰 402px", () => {
  test.use({ viewport: { width: 402, height: 874 }, hasTouch: true, isMobile: true })

  test("말풍선 · 사진 · 이름 · 시각 · 간격이 목표 값이다", async ({ page }) => {
    await ready(page)
    const first = await box(page, "첫 글")
    expect(first.h).toBe(34)
    expect(first.font).toBe("15px")
    expect(first.padX).toBe("10px")
    expect(first.radius).toBe("13px")
    expect(first.left).toBe(52) // 여백 10 + 사진 34 + 간격 8

    const next = await box(page, "이어 쓴 글")
    expect(next.rowTop - first.rowBottom).toBe(6)
    const mine = await box(page, "내 글")
    expect(mine.rowTop - next.rowBottom).toBe(12)
    expect(mine.right).toBe(392)

    const avatar = await row(page, "첫 글").locator("span[aria-hidden]").first().evaluate((el) => ({ w: el.getBoundingClientRect().width, r: getComputedStyle(el).borderTopLeftRadius }))
    expect(avatar).toEqual({ w: 34, r: "13px" })

    // 시각은 묶음 끝 말풍선 옆 아래, 간격 4
    const time = await row(page, "이어 쓴 글").locator("[data-bubble-time] time").evaluate((el) => ({ left: el.getBoundingClientRect().left, bottom: el.getBoundingClientRect().bottom, font: getComputedStyle(el).fontSize }))
    expect(time.font).toBe("10.5px")
    expect(time.left).toBe(next.right + 4)
    expect(time.bottom).toBeLessThanOrEqual(next.bottom)
  })

  test("긴 글은 화면 폭 70% 에서 줄을 바꾼다", async ({ page }) => {
    await ready(page)
    const [other, mine] = await page.locator("section [data-message-id]", { hasText: LONG }).evaluateAll((rows) => rows.map((el) => el.querySelector("[data-message-body]")!.getBoundingClientRect()).map((r) => ({ w: r.width, h: r.height })))
    expect(other.w).toBeLessThanOrEqual(402 * 0.7 + 0.5)
    expect(mine.w).toBeLessThanOrEqual(402 * 0.7 + 0.5)
    expect(other.h).toBeGreaterThan(34)
  })

  test("입력창 47px · 터치 타깃 44px · 입력 글자 16px, 머리 단추 44px", async ({ page }) => {
    await ready(page)
    const pill = page.locator("section [data-composer-pill]").first()
    const g = await pill.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const size = (q: string) => { const b = el.querySelector(q)!.getBoundingClientRect(); return [b.width, b.height] }
      return { h: r.height, left: r.left, right: innerWidth - r.right, font: getComputedStyle(el.querySelector("textarea")!).fontSize, send: size('button[aria-label="보내기"]'), plus: size('button[aria-label="추가"]') }
    })
    expect(g).toEqual({ h: 47, left: 20, right: 20, font: "16px", send: [44, 44], plus: [44, 44] })
    await expect(page.locator("section [data-room-header]")).toHaveCSS("position", "absolute")
    const back = await page.locator('section a[aria-label="채팅방 목록으로"]').boundingBox()
    expect(back?.height).toBe(44)
    for (const b of await page.locator("[data-room-actions] button").all()) expect((await b.boundingBox())!.height).toBe(44)
  })

  test("숨은 답장 단추가 말풍선 폭을 먹거나 탭을 가로채지 않는다", async ({ page }) => {
    await ready(page)
    const actions = row(page, "첫 글").locator('button[aria-label="답장"]').locator("..")
    expect(await actions.evaluate((el) => [getComputedStyle(el).position, getComputedStyle(el).pointerEvents])).toEqual(["absolute", "none"])
  })

  test("업무 · 옴니스 방 머리줄은 그대로다", async ({ page }) => {
    await login(page, "팀장")
    await page.goto("/chat/new")
    const header = page.locator("section [data-room-header]").first()
    await header.waitFor({ timeout: 30_000 })
    expect((await header.boundingBox())!.height).toBeGreaterThanOrEqual(64)
    expect(await header.locator("h1").evaluate((el) => getComputedStyle(el).fontSize)).toBe("18px")
  })
})

test.describe("PC", () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test("말풍선 · 입력창 크기가 그대로다", async ({ page }) => {
    await ready(page)
    const first = await box(page, "첫 글")
    expect(first.font).toBe("17px")
    expect(await row(page, "첫 글").locator("[data-message-body]").evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe("24px")
    await expect(row(page, "이어 쓴 글").locator("[data-bubble-time]")).toBeHidden()
    expect(await page.locator("section [data-composer-pill] textarea").first().evaluate((el) => getComputedStyle(el).fontSize)).toBe("17px")
    await expect(page.locator("section [data-room-header] p").first()).toBeVisible()
  })
})
