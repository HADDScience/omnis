/**
 * 채팅 품질 — 커서 누락 · 다시 보내기 · 남의 삭제 반영 · 위로 읽는 중 끌어내리지 않기.
 * 계획: mydocs/plans/2026-10-30-chat-quality.md
 *
 *   pnpm run test:e2e:local -- tests/feature/chat-quality.spec.ts
 *
 * 커서 시험은 같은 시각의 글을 DB 에 직접 넣는다 — 격리된 시험 DB(E2E_ISOLATED, scripts/e2e-local.mjs)에서만 돈다.
 * 다른 시험은 전사방(default-room)에 글을 남기고, 끝에 남긴 글을 지운다.
 */
import { expect, test, type Browser, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { DEMO_PASSWORD, type DemoUser } from "./_setup"
import { CHAT_DELETED_TEXT, CHAT_PAGE_SIZE } from "../../lib/constants"

const ROOM = "default-room"

// chat-folders.spec.ts 와 같은 이유 — 하이드레이션 전에 누르면 폼이 먹지 않는다
async function login(page: Page, name: DemoUser) {
  await page.goto("/login", { waitUntil: "networkidle" })
  await page.waitForTimeout(1500)
  await page.locator('input[type="text"]').first().fill(name)
  await page.locator('input[type="password"]').first().fill(DEMO_PASSWORD)
  await page.getByRole("button", { name: "로그인", exact: true }).click()
  await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 40_000 })
}

/** 다른 사람 — 브라우저 창 없이 API 로만 글을 쓰고 지운다 */
async function otherUser(browser: Browser, name: DemoUser) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await login(page, name)
  return {
    post: async (content: string) => {
      const res = await page.request.post("/api/chat/messages", { data: { roomId: ROOM, content } })
      expect(res.status()).toBe(201)
      return ((await res.json()) as { id: string }).id
    },
    remove: async (id: string) => expect((await page.request.delete(`/api/chat/messages/${id}`)).ok()).toBe(true),
    close: () => ctx.close(),
  }
}

async function openRoom(page: Page) {
  await page.goto(`/chat/${ROOM}`)
  // 빈 방이면 목록 대신 「아직 메시지가 없습니다」 가 뜬다
  await page
    .locator('[role="log"][aria-label="채팅 메시지"]')
    .or(page.getByText("아직 메시지가 없습니다"))
    .first()
    .waitFor({ timeout: 30_000 })
  await page.locator("textarea").first().waitFor()
}

const bubbles = (page: Page, text: string) =>
  page.locator('[role="log"][aria-label="채팅 메시지"] [data-message-id]', { hasText: text })

const isMessagesApi = (url: URL) => url.pathname.endsWith("/api/chat/messages")

/** 화면에서 글 하나를 보내고, 서버에 몇 개 저장됐는지 센다 */
async function savedCount(page: Page, text: string) {
  const list = (await (await page.request.get(`/api/chat/messages?roomId=${ROOM}`)).json()) as { id: string; content: string }[]
  return list.filter((m) => m.content === text)
}

test("서버에 닿지 못한 글은 「보내지 못함」 으로 남고, 다시 보내면 한 번 저장된다 · 폴링은 멈추지 않는다", async ({ page }) => {
  await login(page, "팀장")
  await openRoom(page)
  const text = `닿지 못함 ${Date.now()}`

  let cut = true
  await page.route(isMessagesApi, async (route) => {
    if (route.request().method() !== "POST" || !cut) return route.continue()
    cut = false
    await route.abort("failed")
  })
  await page.locator("textarea").first().fill(text)
  await page.keyboard.press("Enter")

  // 예전에는 「보내는 중」 이 영원히 남았다. 폴링이 돌아도(서버에 없으니) 실패 표시는 그대로다
  await expect(page.getByText("연결이 끊겨 보내지 못했습니다")).toBeVisible()
  await page.waitForTimeout(4_000)
  await expect(page.getByText("연결이 끊겨 보내지 못했습니다")).toBeVisible()
  expect(await savedCount(page, text)).toHaveLength(0)

  await page.getByRole("button", { name: "다시 보내기" }).click()
  await expect(page.getByText("연결이 끊겨 보내지 못했습니다")).toHaveCount(0)
  await page.waitForTimeout(4_000)
  await expect(bubbles(page, text)).toHaveCount(1)
  const saved = await savedCount(page, text)
  expect(saved).toHaveLength(1)

  // 폴링은 멈추지 않았다 — 화면 밖(API)에서 쓴 글이 들어온다. 예전에는 fetch 가 던지면 이 방 폴링이 멈춘 채 남았다
  const outside = `화면 밖 ${Date.now()}`
  const posted = (await (await page.request.post("/api/chat/messages", { data: { roomId: ROOM, content: outside } })).json()) as { id: string }
  await expect(bubbles(page, outside)).toHaveCount(1, { timeout: 10_000 })

  await page.request.delete(`/api/chat/messages/${saved[0].id}`)
  await page.request.delete(`/api/chat/messages/${posted.id}`)
})

test("응답만 끊긴 글을 다시 보내도 두 번 저장되지 않는다", async ({ page }) => {
  await login(page, "팀장")
  await openRoom(page)
  const text = `응답 끊김 ${Date.now()}`

  // 첫 POST 는 서버에 저장되지만 응답이 화면에 닿지 않는다. 폴링도 막아 둔다 —
  // 열어 두면 폴링이 진짜 글을 들여와 실패 말풍선을 스스로 걷는다(그것도 맞는 동작이다. 여기서는 다시 보내기를 본다)
  let cut = true
  let blockPolls = true
  await page.route(isMessagesApi, async (route) => {
    const req = route.request()
    if (req.method() === "GET" && blockPolls) return route.abort("failed")
    if (req.method() !== "POST" || !cut) return route.continue()
    cut = false
    await route.fetch()
    await route.abort("failed")
  })
  await page.locator("textarea").first().fill(text)
  await page.keyboard.press("Enter")

  await expect(page.getByText("연결이 끊겨 보내지 못했습니다")).toBeVisible()
  expect(await savedCount(page, text)).toHaveLength(1)
  await page.getByRole("button", { name: "다시 보내기" }).click()
  await expect(page.getByText("연결이 끊겨 보내지 못했습니다")).toHaveCount(0)

  blockPolls = false
  await page.waitForTimeout(7_000)
  await expect(bubbles(page, text)).toHaveCount(1)
  const saved = await savedCount(page, text)
  expect(saved).toHaveLength(1)
  await page.request.delete(`/api/chat/messages/${saved[0].id}`)
})

test("거부 — 남의 clientId 로 다시 보내면 그 글을 받아 가지 못한다", async ({ page, browser }) => {
  await login(page, "팀장")
  const clientId = crypto.randomUUID()
  const mine = await page.request.post("/api/chat/messages", { data: { roomId: ROOM, content: `clientId ${clientId}`, clientId } })
  expect(mine.status()).toBe(201)
  const again = await page.request.post("/api/chat/messages", { data: { roomId: ROOM, content: "아무거나", clientId } })
  expect(again.status()).toBe(200)
  expect(((await again.json()) as { id: string }).id).toBe(((await mine.json()) as { id: string }).id)

  const ctx = await browser.newContext()
  const other = await ctx.newPage()
  await login(other, "사원1")
  const stolen = await other.request.post("/api/chat/messages", { data: { roomId: ROOM, content: "훔치기", clientId } })
  expect(stolen.status()).toBe(409)
  await ctx.close()
  await page.request.delete(`/api/chat/messages/${((await mine.json()) as { id: string }).id}`)
})

test("남이 지운 글은 새로고침 없이 내 화면에서도 걷힌다", async ({ page, browser }) => {
  await login(page, "팀장")
  await openRoom(page)
  const other = await otherUser(browser, "부팀장")
  const text = `곧 지울 글 ${Date.now()}`
  const id = await other.post(text)

  await expect(bubbles(page, text)).toHaveCount(1, { timeout: 10_000 })
  await other.remove(id)
  await expect(page.locator(`[data-message-id="${id}"]`)).toContainText(CHAT_DELETED_TEXT, { timeout: 10_000 })
  await expect(page.getByText(text)).toHaveCount(0)
  await other.close()
})

test("위로 올려 읽는 중에 남의 글이 오면 자리를 지키고 「새 메시지」 로 알린다", async ({ page, browser }) => {
  await login(page, "팀장")
  const other = await otherUser(browser, "부팀장")
  const ids: string[] = []
  // 스크롤이 생길 만큼 채운다
  for (let i = 0; i < 25; i++) ids.push(await other.post(`채우기 ${i} ${"줄 ".repeat(20)}`))
  await openRoom(page)

  const scroller = page.locator('[role="log"][aria-label="채팅 메시지"]').locator("..")
  // 방을 열면 맨 아래 — 목록을 비웠다 다시 채우는 사이 맨 위에 머물던 회귀(이 작업 중 시험이 잡았다)
  await expect.poll(() => scroller.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(80)
  await scroller.hover()
  await page.mouse.wheel(0, -1500)
  await page.waitForTimeout(800)
  const before = await scroller.evaluate((el) => el.scrollTop)

  const text = `읽는 중에 온 글 ${Date.now()}`
  ids.push(await other.post(text))
  const pill = page.getByRole("button", { name: /새 메시지 1개/ })
  await expect(pill).toBeVisible({ timeout: 10_000 })
  // 끌려 내려가지 않았다 — 앞 글을 이어 붙였으면 위치가 늘 수는 있어도 바닥으로 가지 않는다
  const after = await scroller.evaluate((el) => ({ top: el.scrollTop, gap: el.scrollHeight - el.clientHeight - el.scrollTop }))
  expect(after.gap).toBeGreaterThan(200)
  expect(after.top).toBeGreaterThanOrEqual(before - 5)

  await pill.click()
  await expect(pill).toHaveCount(0)
  await expect.poll(() => scroller.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(80)

  // 맨 아래에 있으면 남의 글을 따라 내려간다
  const follow = `따라갈 글 ${Date.now()}`
  ids.push(await other.post(follow))
  await expect(bubbles(page, follow)).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole("button", { name: /새 메시지/ })).toHaveCount(0)

  for (const id of ids) await other.remove(id)
  await other.close()
})

test.describe("커서 — 격리된 시험 DB 에서만", () => {
  test.skip(process.env.E2E_ISOLATED !== "true", "같은 시각의 글을 DB 에 직접 넣는다")

  test("같은 시각의 글이 페이지 경계에 걸려도 빠지지 않는다 · 늦게 커밋된 글을 폴링이 줍는다", async ({ page }) => {
    const prisma = new PrismaClient()
    const roomId = `cursor-${Date.now()}`
    try {
      await login(page, "팀장")
      const author = await prisma.user.findFirstOrThrow({ where: { name: "팀장" } })
      await prisma.chatRoom.create({ data: { id: roomId, name: "커서 시험" } })
      // 카톡 이식처럼 같은 초에 한 페이지보다 많은 글
      const at = new Date("2026-08-20T03:00:00.000Z")
      const total = CHAT_PAGE_SIZE + 7
      await prisma.chatMessage.createMany({
        data: Array.from({ length: total }, (_, i) => ({ roomId, authorId: author.id, content: `같은 초 ${i}`, createdAt: at })),
      })

      type Row = { id: string; createdAt: string; content: string }
      const get = async (q: string) => (await (await page.request.get(`/api/chat/messages?roomId=${roomId}&${q}`)).json()) as Row[]
      const first = await get("")
      expect(first).toHaveLength(CHAT_PAGE_SIZE)
      const oldest = first[0]
      const older = await get(`before=${encodeURIComponent(`${oldest.createdAt}|${oldest.id}`)}`)
      const seen = new Set([...first, ...older].map((m) => m.id))
      expect(seen.size).toBe(total)

      // 늦게 커밋된 글 — 마지막으로 본 글보다 3초 앞선 시각으로 나중에 들어온다
      const last = first[first.length - 1]
      const lateAt = new Date(new Date(last.createdAt).getTime() - 3_000)
      const late = await prisma.chatMessage.create({ data: { roomId, authorId: author.id, content: "늦게 커밋", createdAt: lateAt } })
      const poll = await get(`after=${encodeURIComponent(`${last.createdAt}|${last.id}`)}`)
      expect(poll.map((m) => m.id)).toContain(late.id)

      // 거부 — 날짜가 아닌 커서
      expect((await page.request.get(`/api/chat/messages?roomId=${roomId}&before=어제|x`)).status()).toBe(400)
    } finally {
      await prisma.chatMessage.deleteMany({ where: { roomId } })
      await prisma.chatRoom.deleteMany({ where: { id: roomId } })
      await prisma.$disconnect()
    }
  })
})
