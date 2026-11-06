/**
 * 채팅 검색 결과에 도착하면 글이 튕긴다(lib/chat-arrival.ts). 메시지 검색은 전사 · 사람 방과 PC 대화 패널에 있다.
 * Element.animate 를 감싸 재생 횟수와 그때의 위치를 잰다 — 눈으로 보는 움직임은 캡처로 잡히지 않는다.
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
        const viewport = window.visualViewport
        const bottom = Math.min(box.bottom, viewport ? viewport.offsetTop + viewport.height : box.bottom)
        plays.push({ messageId: this.getAttribute("data-message-id"), inList: r.top < bottom && r.bottom > box.top })
      }
      return original.apply(this, args)
    }
  })
}

const plays = (page: Page) => page.evaluate(() => (window as unknown as { __plays: Play[] }).__plays)
const box = (page: Page) => page.getByRole("searchbox", { name: "채팅 검색어" })

async function post(page: Page, roomId: string, content: string) {
  const res = await page.request.post("/api/chat/messages", { data: { roomId, content } })
  expect(res.ok()).toBe(true)
  return ((await res.json()) as { id: string }).id
}

async function peopleRoom(page: Page) {
  const users = (await (await page.request.get("/api/users")).json()) as { id: string; name: string }[]
  const res = await page.request.post("/api/chat/people-rooms", { data: { userIds: [users.find((u) => u.name === "사원1")!.id] } })
  expect(res.ok()).toBe(true)
  return ((await res.json()) as { roomId: string }).roomId
}

async function openSearch(page: Page, roomId: string) {
  await page.goto(`/chat/${roomId}`)
  const toggle = page.getByRole("button", { name: "채팅 검색" })
  await toggle.waitFor({ timeout: 30_000 })
  await expect.poll(() => toggle.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))), { timeout: 30_000 }).toBe(true)
  await toggle.click()
  await box(page).waitFor()
}

const word = () => `도착시험${Date.now()}${Math.random().toString(36).slice(2, 7)}`

for (const [name, use] of [
  ["PC", { viewport: { width: 1440, height: 900 } }],
  ["폰", { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }],
] as const) {
  test.describe(name, () => {
    test.use(use)

    test("전사방 — 도착한 글이 보이는 자리에서 한 번 튕기고, 결과를 오갈 때마다 다시 튕긴다", async ({ page }) => {
      await recordPlays(page)
      await quickLogin(page, "팀장")
      const w = word()
      const older = await post(page, COMPANY, `${w} 옛 글`)
      const newer = await post(page, COMPANY, `${w} 새 글`)
      await openSearch(page, COMPANY)
      await box(page).fill(w)
      await expect.poll(() => plays(page)).toEqual([{ messageId: newer, inList: true }])
      await box(page).press("Enter")
      await expect.poll(async () => (await plays(page)).at(-1)).toEqual({ messageId: older, inList: true })
      await box(page).press("Shift+Enter")
      await expect.poll(async () => (await plays(page)).at(-1)).toEqual({ messageId: newer, inList: true })
      expect(await plays(page)).toHaveLength(3)
      // 재생이 끝나면 움직임이 남지 않는다
      await expect
        .poll(() => page.locator(`[data-message-id="${newer}"]`).evaluate((el) => el.getAnimations().filter((a) => a.id === "chat-arrival").length), { timeout: 3_000 })
        .toBe(0)
    })

    test("사람 방 — 처음 로드 범위 밖의 글도 튕기고, 하나뿐인 결과를 다시 눌러도 튕긴다", async ({ page }) => {
      await recordPlays(page)
      await quickLogin(page, "팀장")
      const roomId = await peopleRoom(page)
      const w = word()
      const target = await post(page, roomId, `${w} 맨 앞 글`)
      // 폴링은 커서보다 10초 앞부터 겹쳐 읽는다(lib/chat-cursor.ts) — 그 밖으로 민다
      await page.waitForTimeout(11_000)
      for (let i = 0; i < 40; i++) await post(page, roomId, `뒤에 쌓는 글 ${i}`)
      await openSearch(page, roomId)
      await expect(page.locator(`[data-message-id="${target}"]`)).toHaveCount(0)
      await box(page).fill(w)
      await expect.poll(() => plays(page), { timeout: 15_000 }).toEqual([{ messageId: target, inList: true }])
      await box(page).press("Enter")
      await expect.poll(async () => (await plays(page)).length).toBe(2)
      expect((await plays(page)).at(-1)).toEqual({ messageId: target, inList: true })
    })

    test("검색어를 고치는 동안 같은 글에 머물면 다시 튕기지 않는다", async ({ page }) => {
      await recordPlays(page)
      await quickLogin(page, "팀장")
      const roomId = await peopleRoom(page)
      const w = word()
      const target = await post(page, roomId, `${w}꼬리 입력 시험`)
      await openSearch(page, roomId)
      await box(page).fill(w)
      await expect.poll(() => plays(page)).toEqual([{ messageId: target, inList: true }])
      await box(page).fill(`${w}꼬리`)
      await expect(page.getByText("1/1")).toBeVisible()
      await page.waitForTimeout(800)
      expect(await plays(page)).toHaveLength(1)
    })

    test("움직임 줄이기 — 튕기지 않고 강조만 한다", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" })
      await recordPlays(page)
      await quickLogin(page, "팀장")
      const roomId = await peopleRoom(page)
      const w = word()
      const target = await post(page, roomId, `${w} 움직임 줄이기`)
      await openSearch(page, roomId)
      await box(page).fill(w)
      // 스트리밍이 끝나기 전에는 서버가 보낸 숨은 조각(<div hidden id="S:…">)에도 같은 줄이 있다 — 보이는 줄만 본다
      const row = page.locator(`[data-message-id="${target}"]`).filter({ visible: true })
      await expect(row).toHaveClass(/ring-amber-400/)
      expect(await plays(page)).toEqual([])
      await expect(row).not.toHaveClass(/ring-amber-400/, { timeout: 3_000 })
      await box(page).press("Enter")
      await expect(row).toHaveClass(/ring-amber-400/)
      expect(await plays(page)).toEqual([])
    })
  })
}

test.describe("폰 키보드", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test("키보드가 열려 있어도 도착한 글은 키보드 위에 보인다", async ({ page }) => {
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
    await recordPlays(page)
    await quickLogin(page, "팀장")
    const roomId = await peopleRoom(page)
    const w = word()
    const target = await post(page, roomId, `${w} 키보드 위`)
    for (let i = 0; i < 12; i++) await post(page, roomId, `뒤에 쌓는 글 ${i}`)
    await openSearch(page, roomId)
    await box(page).tap()
    await page.evaluate(() => (window as unknown as { __keyboard: (h: number) => void }).__keyboard(450))
    await expect.poll(() => page.evaluate(() => document.documentElement.hasAttribute("data-keyboard-docked"))).toBe(true)
    await box(page).fill(w)
    await expect.poll(() => plays(page)).toEqual([{ messageId: target, inList: true }])
  })
})

test("PC 대화 패널 — 전체 채팅 검색도 튕긴다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await recordPlays(page)
  await quickLogin(page, "팀장")
  const w = word()
  const target = await post(page, COMPANY, `${w} 패널`)
  await page.goto("/calendar")
  const dock = page.getByRole("button", { name: /^대화 패널 열기/ })
  await dock.waitFor({ timeout: 30_000 })
  await expect.poll(() => dock.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))), { timeout: 30_000 }).toBe(true)
  await dock.click()
  const panel = page.locator('aside[aria-label="대화 패널"]')
  await panel.getByRole("button", { name: /검색/ }).first().click()
  await box(page).fill(w)
  await expect.poll(() => plays(page), { timeout: 15_000 }).toEqual([{ messageId: target, inList: true }])
})
