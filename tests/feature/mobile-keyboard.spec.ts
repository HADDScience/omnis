/**
 * 폰 키보드가 열리면 입력창이 키보드 바로 위에 붙는다(hooks/use-keyboard-open.ts).
 *
 * 시험 브라우저에는 화면 키보드가 없어 visualViewport 를 모의한다. 실제 뷰포트는 그대로 두고 보이는 높이만 줄이므로
 * iOS 처럼 키보드가 레이아웃 위에 덮이는 경우를 흉내 낸다. 키보드 보조 막대 · 화면 밀기 애니메이션은 실기기에서만 보인다.
 */
import { expect, test, type Page } from "@playwright/test"
import { quickLogin } from "./_setup"

const COMPANY = "/chat/default-room"
const PILL = "[data-composer-pill]"
const KEYBOARD_TOP = 450
const box = (page: Page) => page.locator(`${PILL} textarea`).first()
const hydrated = (page: Page) =>
  expect.poll(() => box(page).evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))), { timeout: 30_000 }).toBe(true)
const docked = (page: Page) => page.evaluate(() => document.documentElement.hasAttribute("data-keyboard-docked"))

async function mockViewport(page: Page) {
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
}

const keyboard = (page: Page, top: number | null) =>
  page.evaluate((h) => (window as unknown as { __keyboard: (h: number | null) => void }).__keyboard(h), top)

/** 하단 nav 가 화면 안에 있는가. 내리는 데 0.2초 걸린다 */
const navOnScreen = (page: Page) =>
  page.evaluate(() => {
    const nav = Array.from(document.querySelectorAll('nav[aria-label="주 메뉴"]')).at(-1) as HTMLElement
    return getComputedStyle(nav).display !== "none" && nav.getBoundingClientRect().top < window.innerHeight
  })

const pillBottom = (page: Page) => page.locator(PILL).first().evaluate((el) => el.getBoundingClientRect().bottom)

async function roomUrls(page: Page) {
  const users = (await (await page.request.get("/api/users")).json()) as { id: string; name: string }[]
  const other = users.find((u) => u.name === "사원1")
  expect(other).toBeTruthy()
  const res = await page.request.post("/api/chat/people-rooms", { data: { userIds: [other!.id] } })
  expect(res.ok()).toBe(true)
  const data = (await (await page.request.get("/api/tasks")).json()) as { id: string }[] | { tasks: { id: string }[] }
  const tasks = Array.isArray(data) ? data : data.tasks
  expect(tasks.length).toBeGreaterThan(0)
  return {
    전사: COMPANY,
    사람: `/chat/${((await res.json()) as { roomId: string }).roomId}`,
    업무: `/chat/task/${tasks[0].id}`,
    옴니스: "/chat/new",
  }
}

async function open(page: Page, url: string) {
  await page.goto(url)
  await box(page).waitFor({ timeout: 30_000 })
  await hydrated(page)
}

test.describe("폰", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test("입력창이 키보드 바로 위에 붙고, 대화방에는 nav 가 없다(네 방 공통)", async ({ page }) => {
    await mockViewport(page)
    await quickLogin(page, "팀장")
    for (const [name, url] of Object.entries(await roomUrls(page))) {
      await open(page, url)
      const send = page.locator(`${PILL} button[aria-label="보내기"]`).first()
      const sendBefore = await send.evaluate((el) => {
        const pill = el.closest("[data-composer-pill]")!.getBoundingClientRect()
        const r = el.getBoundingClientRect()
        return { right: pill.right - r.right, bottom: pill.bottom - r.bottom }
      })
      const bottomBefore = await pillBottom(page)

      await box(page).tap()
      // 포커스만으로는 판단하지 않는다 — 물리 키보드
      await page.waitForTimeout(100)
      expect(await docked(page), `${name} 포커스만`).toBe(false)
      expect(await navOnScreen(page), `${name} 포커스만`).toBe(false)

      await keyboard(page, KEYBOARD_TOP)
      await expect.poll(() => docked(page), name).toBe(true)
      expect(await navOnScreen(page), `${name} nav`).toBe(false)
      const bottom = await pillBottom(page)
      expect(bottom, `${name} 키보드에 가려지지 않는다`).toBeLessThanOrEqual(KEYBOARD_TOP)
      expect(KEYBOARD_TOP - bottom, `${name} 키보드와의 틈`).toBeLessThanOrEqual(8)
      // 대화 내용 칸은 남은 높이를 쓴다 — 머리줄이 화면 밖으로 밀리지 않는다
      expect(await page.evaluate(() => document.documentElement.scrollHeight), name).toBeLessThanOrEqual(844)

      const sendAfter = await send.evaluate((el) => {
        const pill = el.closest("[data-composer-pill]")!.getBoundingClientRect()
        const r = el.getBoundingClientRect()
        return { right: pill.right - r.right, bottom: pill.bottom - r.bottom }
      })
      expect(sendAfter, `${name} 전송 단추 자리`).toEqual(sendBefore)

      await keyboard(page, null)
      await expect.poll(() => docked(page), name).toBe(false)
      expect(await navOnScreen(page), `${name} 닫힘`).toBe(false)
      expect(await pillBottom(page), `${name} 닫힘`).toBe(bottomBefore)
    }
  })

  test("보낸 뒤에도 포커스와 붙은 자리를 지킨다", async ({ page }) => {
    await mockViewport(page)
    await quickLogin(page, "팀장")
    await open(page, COMPANY)
    await box(page).tap()
    await keyboard(page, KEYBOARD_TOP)
    await expect.poll(() => docked(page)).toBe(true)
    await box(page).fill(`키보드 붙은 채 보내기 ${Date.now()}`)
    await page.locator(`${PILL} button[aria-label="보내기"]`).first().tap()
    await expect(box(page)).toHaveValue("")
    expect(await box(page).evaluate((el) => document.activeElement === el)).toBe(true)
    expect(await docked(page)).toBe(true)
    expect(KEYBOARD_TOP - (await pillBottom(page))).toBeLessThanOrEqual(8)
  })

  test("키보드가 열린 채 ＋ 를 누르면 키보드를 내리고 시트를 올린다", async ({ page }) => {
    await mockViewport(page)
    await quickLogin(page, "팀장")
    await open(page, COMPANY)
    await box(page).tap()
    await keyboard(page, KEYBOARD_TOP)
    await expect.poll(() => docked(page)).toBe(true)
    await page.locator(`${PILL} button[aria-label="추가"]`).first().tap()
    await expect(page.locator("[data-composer-plus-sheet]")).toBeVisible()
    expect(await box(page).evaluate((el) => document.activeElement === el)).toBe(false)
    await expect.poll(() => docked(page)).toBe(false)
  })

  test("읽던 자리를 지킨다 — 입력창 바로 위 글이 그대로다", async ({ page }) => {
    await mockViewport(page)
    await quickLogin(page, "팀장")
    // 전사방에 글을 몰아넣지 않는다 — 다른 시험이 그 방의 폴링을 잰다
    const room = (await roomUrls(page)).사람
    const roomId = room.split("/").at(-1)
    for (let i = 0; i < 30; i++) {
      const res = await page.request.post("/api/chat/messages", { data: { roomId, content: `자리 시험 ${i} ${Date.now()}` } })
      expect(res.ok()).toBe(true)
    }
    await open(page, room)
    const list = page.locator("[data-keep-bottom]").first()
    const fromBottom = () => list.evaluate((el) => Math.round(el.scrollHeight - el.clientHeight - el.scrollTop))

    // 맨 아래에 있으면 맨 아래에 남는다
    await expect.poll(fromBottom).toBeLessThanOrEqual(1)
    await box(page).tap()
    await keyboard(page, KEYBOARD_TOP)
    await expect.poll(() => docked(page)).toBe(true)
    expect(await fromBottom()).toBeLessThanOrEqual(1)
    await keyboard(page, null)
    await expect.poll(() => docked(page)).toBe(false)
    expect(await fromBottom()).toBeLessThanOrEqual(1)

    // 위로 올려 읽는 중이면 그 거리를 지킨다
    await list.evaluate((el) => {
      el.scrollTop = el.scrollHeight - el.clientHeight - 400
    })
    await expect.poll(fromBottom).toBe(400)
    await keyboard(page, KEYBOARD_TOP)
    await expect.poll(() => docked(page)).toBe(true)
    expect(await fromBottom()).toBe(400)
    await keyboard(page, null)
    await expect.poll(() => docked(page)).toBe(false)
    expect(await fromBottom()).toBe(400)
  })

  test("입력창이 아닌 칸은 nav 만 내리고 화면 높이는 그대로다", async ({ page }) => {
    await mockViewport(page)
    await quickLogin(page, "팀장")
    await page.goto("/chat")
    const search = page.getByPlaceholder("방 · 업무 · 마지막 글 검색")
    await search.waitFor({ timeout: 30_000 })
    await expect.poll(() => search.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))), { timeout: 30_000 }).toBe(true)
    await search.tap()
    await keyboard(page, KEYBOARD_TOP)
    await expect.poll(() => navOnScreen(page)).toBe(false)
    expect(await docked(page)).toBe(false)
  })
})

test.describe("PC", () => {
  for (const [name, viewport] of [
    ["넓은 창", { width: 1440, height: 900 }],
    ["좁은 창", { width: 500, height: 900 }],
  ] as const) {
    test(`${name} — 포커스가 있고 창 높이가 줄어도 레이아웃이 그대로다`, async ({ page }) => {
      await mockViewport(page)
      await page.setViewportSize(viewport)
      await quickLogin(page, "팀장")
      await open(page, COMPANY)
      await box(page).click()
      const before = await pillBottom(page)
      await keyboard(page, 400)
      await page.waitForTimeout(300)
      expect(await docked(page)).toBe(false)
      expect(await pillBottom(page)).toBe(before)
    })
  }
})
