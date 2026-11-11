/**
 * 폰 채팅 — 글을 오른쪽으로 밀면 답장(components/chat/swipe-reply.tsx · lib/swipe-reply.ts).
 * 터치는 CDP Input.dispatchTouchEvent 로 한 점씩 보낸다(Chromium). 방을 시험 DB 에 직접 넣는다 — 로컬 DB(CI · e2e-local)에서만.
 * SWIPE_SHOTS=<폴더> 를 주면 미는 동안의 연속 화면을 남긴다(GIF 재료).
 */
import fs from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { expect, test, type CDPSession, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { login } from "./_setup"

const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")
test.skip(!LOCAL_DB, "시험 DB 를 직접 고친다")
test.describe.configure({ mode: "serial" })

const SHOTS = process.env.SWIPE_SHOTS
const prisma = LOCAL_DB ? new PrismaClient() : (null as unknown as PrismaClient)
const roomId = randomUUID()

test.beforeAll(async () => {
  const me = await prisma.user.findFirstOrThrow({ where: { name: "팀장" } })
  const a = await prisma.user.findFirstOrThrow({ where: { name: "사원1" } })
  await prisma.chatRoom.create({ data: { id: roomId, name: "밀어 답장 시험", kind: "GROUP", createdById: me.id, lastMessageAt: new Date(), members: { create: [{ userId: me.id }, { userId: a.id }] } } })
  const base = Date.now() - 600_000
  const lines: [string, string, number][] = [
    [a.id, "견적서 받으셨나요?", 0],
    [a.id, "링크 남겨요 https://example.com/quote", 10_000],
    [me.id, "네 확인했습니다", 120_000],
    [a.id, "그럼 금요일까지 정리해 주세요", 240_000],
  ]
  for (const [authorId, content, at] of lines) {
    await prisma.chatMessage.create({ data: { roomId, authorId, content, createdAt: new Date(base + at), changedAt: new Date(base + at) } })
  }
})
test.afterAll(async () => {
  await prisma?.chatRoom.delete({ where: { id: roomId } }).catch(() => {})
  await prisma?.$disconnect()
})

const ready = async (page: Page) => {
  await login(page, "팀장")
  await page.goto(`/chat/${roomId}`)
  await page.locator("section [data-message-id] [data-message-body]").first().waitFor({ timeout: 30_000 })
}
const row = (page: Page, text: string) => page.locator("section [data-swipe-reply]", { hasText: text }).first()
const replyBar = (page: Page) => page.locator("[data-room-composer-chrome]").getByText(/에게 답장$/)

async function bubbleStart(page: Page, text: string) {
  const b = (await row(page, text).locator("[data-message-body]").boundingBox())!
  return { x: b.x + 16, y: b.y + b.height / 2 }
}

/** 한 손가락 — 점들을 차례로 지나고(사이 간격 ms) 뗀다. onStep 은 움직인 뒤마다 */
async function drag(cdp: CDPSession, points: { x: number; y: number }[], gap = 16, onStep?: (i: number) => Promise<void>) {
  const [first, ...rest] = points
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: first.x, y: first.y }] })
  for (let i = 0; i < rest.length; i++) {
    await new Promise((r) => setTimeout(r, gap))
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: rest[i].x, y: rest[i].y }] })
    if (onStep) await onStep(i)
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
}
const line = (from: { x: number; y: number }, dx: number, dy: number, steps: number) =>
  Array.from({ length: steps + 1 }, (_, i) => ({ x: from.x + (dx * i) / steps, y: from.y + (dy * i) / steps }))

const offsetOf = (page: Page, text: string) =>
  row(page, text).locator("[data-swipe-reply-body]").evaluate((el) => {
    const m = /translate3d\(([\d.]+)px/.exec((el as HTMLElement).style.transform)
    return m ? Number(m[1]) : 0
  })

test.describe("폰 — 오른쪽으로 밀어 답장", () => {
  test.use({ viewport: { width: 402, height: 874 }, hasTouch: true, isMobile: true })

  test("말풍선이 고무줄처럼 72px 까지만 끌리고, 48px 을 넘겨 떼면 답장 · 입력창 포커스 · 제자리로", async ({ page }) => {
    await ready(page)
    const cdp = await page.context().newCDPSession(page)
    // 햅틱 — 준비 선을 넘는 순간 한 번
    await page.evaluate(() => {
      const w = window as unknown as { __vib: number[] }
      w.__vib = []
      Object.defineProperty(navigator, "vibrate", { configurable: true, value: (ms: number) => (w.__vib.push(ms), true) })
    })
    const text = "견적서 받으셨나요?"
    const from = await bubbleStart(page, text)
    const offsets: number[] = []
    let frame = 0
    if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })
    const snap = async () => {
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `swipe-${String(frame++).padStart(2, "0")}.png`) })
    }
    await snap()
    await drag(cdp, line(from, 200, 6, 20), 16, async () => {
      offsets.push(await offsetOf(page, text))
      await snap()
    })
    // 손가락은 200px 갔지만 말풍선은 72px 을 넘지 않고, 늘 손가락보다 덜 간다
    expect(Math.max(...offsets)).toBeLessThanOrEqual(72)
    expect(Math.max(...offsets)).toBeGreaterThan(60)
    for (let i = 1; i < offsets.length; i++) expect(offsets[i]).toBeGreaterThanOrEqual(offsets[i - 1])
    expect(await page.evaluate(() => (window as unknown as { __vib: number[] }).__vib)).toEqual([10])

    await expect(replyBar(page)).toHaveText("사원1에게 답장")
    await expect(page.locator("[data-room-composer-chrome]")).toContainText(text)
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("TEXTAREA")
    // 스프링으로 제자리
    await expect.poll(() => offsetOf(page, text)).toBe(0)
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(70)
      await snap()
    }
    await page.getByRole("button", { name: "답장 취소" }).click()
  })

  test("48px 을 못 넘기면 · 세로로 밀면 · 왼쪽 가장자리에서 시작하면 · 길게 누른 뒤 밀면 답장하지 않는다", async ({ page }) => {
    await ready(page)
    const cdp = await page.context().newCDPSession(page)
    const text = "그럼 금요일까지 정리해 주세요"
    const from = await bubbleStart(page, text)

    // 짧게 — 손가락 50px(끌린 거리 약 36px)
    await drag(cdp, line(from, 50, 2, 6))
    await page.waitForTimeout(150)
    await expect(replyBar(page)).toHaveCount(0)

    // 세로 — 스크롤 몸짓
    await drag(cdp, line(from, 30, -160, 10))
    await page.waitForTimeout(150)
    await expect(replyBar(page)).toHaveCount(0)
    expect(await offsetOf(page, text)).toBe(0)

    // 왼쪽 가장자리(20px 안)에서 시작 — iOS 뒤로 가기 몫
    await drag(cdp, line({ x: 8, y: from.y }, 220, 0, 20))
    await page.waitForTimeout(150)
    await expect(replyBar(page)).toHaveCount(0)

    // 길게 누른 뒤(0.5초) 옆으로 — 글자 고르기 · 시스템 메뉴 몫
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] })
    await page.waitForTimeout(500)
    for (const p of line(from, 200, 0, 12).slice(1)) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [p] })
      await page.waitForTimeout(16)
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    await page.waitForTimeout(150)
    await expect(replyBar(page)).toHaveCount(0)
    expect(await offsetOf(page, text)).toBe(0)
  })

  test("링크 위에서 밀어도 링크가 열리지 않고 답장만, 링크 탭은 그대로", async ({ page, context }) => {
    await ready(page)
    const cdp = await page.context().newCDPSession(page)
    const text = "링크 남겨요"
    const link = row(page, text).locator("a[href^='https://example.com']")
    const b = (await link.boundingBox())!
    let opened = 0
    context.on("page", () => opened++)
    await page.route("https://example.com/**", (r) => r.fulfill({ body: "ok" }))
    await drag(cdp, line({ x: b.x + 6, y: b.y + b.height / 2 }, 200, 4, 20))
    await expect(replyBar(page)).toHaveText("사원1에게 답장")
    await page.waitForTimeout(300)
    expect(opened).toBe(0)
    expect(page.url()).toContain(`/chat/${roomId}`)
    await page.getByRole("button", { name: "답장 취소" }).click()
  })

  test("움직임 줄이기 — 말풍선은 움직이지 않고 아이콘만, 떼면 답장", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" })
    await ready(page)
    const cdp = await page.context().newCDPSession(page)
    const text = "견적서 받으셨나요?"
    const from = await bubbleStart(page, text)
    const seen: { offset: number; armed: string | null; opacity: string }[] = []
    await drag(cdp, line(from, 200, 0, 20), 16, async () => {
      seen.push(
        await row(page, text).evaluate((el) => {
          const body = el.querySelector("[data-swipe-reply-body]") as HTMLElement
          const icon = el.querySelector("[data-swipe-reply-icon]") as HTMLElement
          return { offset: body.style.transform ? 1 : 0, armed: icon.dataset.armed ?? null, opacity: icon.style.opacity }
        }),
      )
    })
    expect(seen.every((s) => s.offset === 0)).toBe(true)
    expect(seen.at(-1)).toMatchObject({ armed: "true", opacity: "1" })
    await expect(replyBar(page)).toHaveText("사원1에게 답장")
    await page.getByRole("button", { name: "답장 취소" }).click()
  })
})

test.describe("PC — 그대로", () => {
  test.use({ viewport: { width: 1280, height: 860 } })

  test("마우스로 끌어도 답장하지 않는다(글자 고르기)", async ({ page }) => {
    await ready(page)
    const from = await bubbleStart(page, "견적서 받으셨나요?")
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x + 200, from.y + 4, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(200)
    await expect(replyBar(page)).toHaveCount(0)
    expect(await offsetOf(page, "견적서 받으셨나요?")).toBe(0)
  })
})
