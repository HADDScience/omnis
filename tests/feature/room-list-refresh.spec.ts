/**
 * 왼쪽 방 목록 — 열린 방에 새 글이 생길 때만 다시 읽는다. 새 글이 없으면 요청이 늘지 않는다.
 * 목록 자체의 30초 폴링은 시험 시간 안에 닿지 않게 짧게 재거나 시계를 고정하지 않는다 — 재는 구간을 30초보다 짧게 둔다.
 */
import { expect, test, type Browser, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { login, type DemoUser } from "./_setup"

const COMPANY = "default-room"
const PILL = "[data-composer-pill]"
const box = (page: Page) => page.locator(`${PILL} textarea`).first()
const hydrated = (page: Page) =>
  expect.poll(() => box(page).evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))), { timeout: 30_000 }).toBe(true)

/** 목록 요청과 대화창 폴링을 센다. 검색(q=)은 목록 갱신이 아니다 */
function watch(page: Page) {
  const seen = { rooms: 0, messages: 0 }
  page.on("request", (r) => {
    if (r.method() !== "GET") return
    const url = new URL(r.url())
    if (url.pathname.endsWith("/api/chat/rooms") && !url.searchParams.has("q")) seen.rooms++
    if (url.pathname.endsWith("/api/chat/messages")) seen.messages++
  })
  return seen
}

async function open(page: Page, url: string) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(url)
  await box(page).waitFor({ timeout: 30_000 })
  await hydrated(page)
  // 첫 목록 읽기가 끝난 뒤부터 잰다
  await expect(page.locator('aside[aria-label="채팅방 목록"]').getByRole("link").first()).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(1_000)
}

async function other(browser: Browser, name: DemoUser) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await login(page, name)
  return { ctx, page }
}

const listed = (page: Page, text: string) => page.locator('aside[aria-label="채팅방 목록"]').getByText(text)

test("새 글이 없으면 대화창은 폴링해도 목록은 읽지 않는다", async ({ page }) => {
  await login(page, "팀장")
  const seen = watch(page)
  await open(page, `/chat/${COMPANY}`)
  seen.rooms = 0
  seen.messages = 0
  await page.waitForTimeout(10_000)
  expect(seen.messages, "대화창 폴링은 돈다").toBeGreaterThanOrEqual(2)
  expect(seen.rooms, "목록 요청 0").toBe(0)
})

test("받은 글 — 왼쪽 미리보기가 30초를 기다리지 않고 맞춰지고, 그 뒤 다시 조용하다", async ({ page, browser }) => {
  await login(page, "팀장")
  const seen = watch(page)
  await open(page, `/chat/${COMPANY}`)
  const sender = await other(browser, "사원1")
  seen.rooms = 0
  const text = `받은 글 ${Date.now()}`
  expect((await sender.page.request.post("/api/chat/messages", { data: { roomId: COMPANY, content: text } })).ok()).toBe(true)
  await expect(listed(page, text).first()).toBeVisible({ timeout: 10_000 })
  expect(seen.rooms).toBe(1)
  seen.rooms = 0
  await page.waitForTimeout(7_000)
  expect(seen.rooms, "새 글이 더 없으면 다시 읽지 않는다").toBe(0)
  await sender.ctx.close()
})

test("연달아 받은 글은 한 번으로 묶인다", async ({ page, browser }) => {
  await login(page, "팀장")
  const seen = watch(page)
  await open(page, `/chat/${COMPANY}`)
  const sender = await other(browser, "사원2")
  seen.rooms = 0
  const stamp = Date.now()
  for (let i = 0; i < 5; i++) {
    expect((await sender.page.request.post("/api/chat/messages", { data: { roomId: COMPANY, content: `연속 ${stamp} ${i}` } })).ok()).toBe(true)
  }
  await expect(listed(page, `연속 ${stamp} 4`).first()).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(4_000)
  // 글이 폴링 두 번에 걸쳐 들어올 수 있다 — 글 수(5)만큼 읽지 않으면 된다
  expect(seen.rooms).toBeLessThanOrEqual(2)
  await sender.ctx.close()
})

test("내가 보낸 글 — 전사 · 사람 · 업무 방 모두 왼쪽에 바로 맞춰지고, 연달아 보내도 묶인다", async ({ page }) => {
  await login(page, "팀장")
  const users = (await (await page.request.get("/api/users")).json()) as { id: string; name: string }[]
  const dm = (await (await page.request.post("/api/chat/people-rooms", { data: { userIds: [users.find((u) => u.name === "사원1")!.id] } })).json()) as { roomId: string }
  const tasksBody = (await (await page.request.get("/api/tasks")).json()) as { id: string }[] | { tasks: { id: string }[] }
  const task = (Array.isArray(tasksBody) ? tasksBody : tasksBody.tasks)[0]
  const seen = watch(page)
  for (const [name, url] of [["전사", `/chat/${COMPANY}`], ["사람", `/chat/${dm.roomId}`], ["업무", `/chat/task/${task.id}`]] as const) {
    await open(page, url)
    seen.rooms = 0
    const first = `내 글 ${name} ${Date.now()}`
    const second = `${first} 둘째`
    await box(page).fill(first)
    await box(page).press("Enter")
    await box(page).fill(second)
    await box(page).press("Enter")
    await expect(listed(page, second).first(), name).toBeVisible({ timeout: 10_000 })
    expect(seen.rooms, `${name} 묶임`).toBeLessThanOrEqual(2)
    expect(seen.rooms, `${name} 다시 읽음`).toBeGreaterThanOrEqual(1)
  }
})

test.describe("격리된 시험 DB 에서만", () => {
  test.skip(process.env.E2E_ISOLATED !== "true", "옴니스 방을 DB 에 직접 넣는다")

  test("옴니스 방 — 서버가 글을 받으면 다시 읽고, 거절되면 읽지 않는다", async ({ page }) => {
    const prisma = new PrismaClient()
    try {
      await login(page, "팀장")
      const me = await prisma.user.findFirstOrThrow({ where: { name: "팀장" } })
      const roomId = `omnis-list-${Date.now()}`
      await prisma.chatRoom.create({ data: { id: roomId, name: "목록 시험", kind: "OMNIS_DM", createdById: me.id, members: { create: [{ userId: me.id }] } } })
      let accept = false
      let posts = 0
      await page.route(`**/api/agent/rooms/${roomId}`, async (route) => {
        if (route.request().method() !== "POST") return route.continue()
        posts++
        if (!accept) return route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "시험" }) })
        return route.fulfill({ status: 200, headers: { "x-question-id": "q-test", "content-type": "text/event-stream" }, body: "data: [DONE]\n\n" })
      })
      const seen = watch(page)
      await open(page, `/chat/${roomId}`)
      seen.rooms = 0
      await box(page).fill("거절될 글입니다")
      await box(page).press("Enter")
      await page.waitForTimeout(3_000)
      expect(seen.rooms, "거절 — 목록을 읽지 않는다").toBe(0)
      accept = true
      await box(page).fill("받아 줄 글입니다")
      await box(page).press("Enter")
      await expect.poll(() => posts, { timeout: 8_000, message: "두 번째 글이 서버로 갔다" }).toBe(2)
      await expect.poll(() => seen.rooms, { timeout: 8_000 }).toBeGreaterThanOrEqual(1)
    } finally {
      await prisma.$disconnect()
    }
  })
})
