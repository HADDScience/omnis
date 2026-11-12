/**
 * 답장 인용(원글 미리보기)을 누르면 원글로 간다 — 불러온 범위 밖이면 그 앞뒤를 불러와서, 도착하면 튕기고 잠깐 칠한다
 * (검색 이동과 같은 길: components/chat/chat-panel.tsx jumpTo · lib/chat-arrival.ts). 지운 원글은 안내 토스트만.
 * 폰에서는 인용을 밀면 답장(#192)이고 원글로 가지 않는다.
 */
import { expect, test, type Page } from "@playwright/test"
import { quickLogin } from "./_setup"

type Play = { messageId: string | null; inList: boolean }
const COMPANY = "default-room"

async function recordPlays(page: Page) {
  await page.addInitScript(() => {
    const plays: unknown[] = []
    ;(window as unknown as { __plays: unknown[] }).__plays = plays
    const original = Element.prototype.animate
    Element.prototype.animate = function (this: Element, ...args: Parameters<typeof original>) {
      const options = args[1]
      if (typeof options === "object" && options?.id === "chat-arrival") {
        const r = this.getBoundingClientRect()
        const box = this.closest("[data-keep-bottom]")!.getBoundingClientRect()
        plays.push({ messageId: this.getAttribute("data-message-id"), inList: r.top < box.bottom && r.bottom > box.top })
      }
      return original.apply(this, args)
    }
  })
}
const plays = (page: Page) => page.evaluate(() => (window as unknown as { __plays: Play[] }).__plays)

async function post(page: Page, roomId: string, content: string, replyToId?: string) {
  const res = await page.request.post("/api/chat/messages", { data: { roomId, content, replyToId } })
  expect(res.ok()).toBe(true)
  return ((await res.json()) as { id: string }).id
}

async function peopleRoom(page: Page) {
  const users = (await (await page.request.get("/api/users")).json()) as { id: string; name: string }[]
  const res = await page.request.post("/api/chat/people-rooms", { data: { userIds: [users.find((u) => u.name === "사원1")!.id] } })
  expect(res.ok()).toBe(true)
  return ((await res.json()) as { roomId: string }).roomId
}

/** 화면에 보이는 인용 — PC 는 말풍선 위 한 줄, 폰 메신저는 말풍선 안 */
const quoteOf = (page: Page, replyId: string) =>
  page.locator(`[data-message-id="${replyId}"]`).getByRole("button", { name: /원래 메시지로 이동/ }).locator("visible=true")

async function openRoom(page: Page, roomId: string, replyId: string) {
  await page.goto(`/chat/${roomId}`)
  const quote = quoteOf(page, replyId)
  await quote.waitFor({ timeout: 30_000 })
  await expect.poll(() => quote.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))), { timeout: 30_000 }).toBe(true)
  return quote
}

const word = () => `인용이동${Date.now()}${Math.random().toString(36).slice(2, 7)}`

for (const [name, use] of [
  ["PC", { viewport: { width: 1440, height: 900 } }],
  ["폰", { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }],
] as const) {
  test.describe(name, () => {
    test.use(use)

    test("전사방 — 불러온 범위 밖 원글도 앞 글을 불러와 그 자리로 가서 튕긴다", async ({ page }) => {
      test.setTimeout(180_000)
      await recordPlays(page)
      await quickLogin(page, "팀장")
      const w = word()
      const original = await post(page, COMPANY, `${w} 원글`)
      // 한 번에 불러오는 30건의 두 쪽 밖으로 밀어낸다 — 방을 연 뒤 맨 위에 닿아 한 쪽을 더 불러와도 원글은 아직 밖이다
      for (let i = 0; i < 70; i++) await post(page, COMPANY, `${w} 사이 글 ${i}`)
      const reply = await post(page, COMPANY, `${w} 답장`, original)
      const quote = await openRoom(page, COMPANY, reply)
      let around = 0
      page.on("request", (r) => {
        if (r.url().includes(`around=${original}`)) around++
      })
      // CI 에서는 방을 연 직후 이전 글을 이어 불러오기도 한다(2026-11-12 main 실패) — 원글이 이미 있으면 불러오기 확인만 건너뛴다
      const loadedBefore = await page.locator(`[data-message-id="${original}"]`).count()

      if (name === "폰") await quote.tap()
      else await quote.click()
      await expect.poll(async () => (await plays(page)).at(-1), { timeout: 15_000 }).toEqual({ messageId: original, inList: true })
      await expect(page.locator(`[data-message-id="${original}"]`)).toBeInViewport()
      if (loadedBefore === 0) expect(around).toBe(1)
    })

    test("단톡 · 1:1 — 범위 안 원글은 다시 받지 않고 바로 가고, 지운 원글은 찾을 수 없다고 한다", async ({ page }) => {
      await recordPlays(page)
      await quickLogin(page, "팀장")
      const roomId = await peopleRoom(page)
      const w = word()
      const original = await post(page, roomId, `${w} 원글`)
      const reply = await post(page, roomId, `${w} 답장`, original)
      const gone = await post(page, roomId, `${w} 곧 지울 글`)
      const orphan = await post(page, roomId, `${w} 지운 글에 단 답장`, gone)
      expect((await page.request.delete(`/api/chat/messages/${gone}`)).ok()).toBe(true)

      const quote = await openRoom(page, roomId, reply)
      let around = 0
      page.on("request", (r) => {
        if (r.url().includes("around=")) around++
      })
      if (name === "폰") await quote.tap()
      else await quote.click()
      await expect.poll(async () => (await plays(page)).at(-1)).toEqual({ messageId: original, inList: true })
      expect(around).toBe(0)

      const before = (await plays(page)).length
      const orphanQuote = quoteOf(page, orphan)
      if (name === "폰") await orphanQuote.tap()
      else await orphanQuote.click()
      await expect(page.getByText("원래 메시지를 찾을 수 없어요")).toBeVisible()
      expect(await plays(page)).toHaveLength(before)
    })
  })
}

test.describe("폰 — 인용을 밀면 답장이고 원글로 가지 않는다", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test("인용 위에서 오른쪽으로 밀기", async ({ page }) => {
    await recordPlays(page)
    await quickLogin(page, "팀장")
    const roomId = await peopleRoom(page)
    const w = word()
    const original = await post(page, roomId, `${w} 원글`)
    const reply = await post(page, roomId, `${w} 답장`, original)
    const quote = await openRoom(page, roomId, reply)
    const b = (await quote.boundingBox())!
    const cdp = await page.context().newCDPSession(page)
    const from = { x: b.x + 16, y: b.y + b.height / 2 }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] })
    for (let i = 1; i <= 12; i++) {
      await new Promise((r) => setTimeout(r, 16))
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x + i * 10, y: from.y }] })
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })

    await expect(page.locator("[data-room-composer-chrome]").getByText(/에게 답장$/)).toBeVisible()
    await page.waitForTimeout(500)
    expect(await plays(page)).toEqual([])
  })
})
