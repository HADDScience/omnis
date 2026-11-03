/**
 * 나와의 대화 · 같은 상대의 1:1 은 하나 · 방 밖 사람의 접근.
 * 규칙의 단위 시험: lib/chat-people-rules.test.ts
 */
import { expect, test, type Browser, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { dmKeyOf } from "../../lib/chat-people-rules"
import { login, type DemoUser } from "./_setup"

async function as(browser: Browser, name: DemoUser) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await login(page, name)
  return { ctx, page }
}

async function userId(page: Page, name: string) {
  const list = (await (await page.request.get("/api/users")).json()) as { id: string; name: string }[]
  return list.find((u) => u.name === name)!.id
}

/** 방 밖 사람에게 이 방은 어느 길로도 열리지 않는다 */
async function expectLockedOut(page: Page, roomId: string, secret: string) {
  expect((await page.goto(`/chat/${roomId}`))?.status(), "방 화면").toBe(404)
  expect((await page.request.get(`/api/chat/people-rooms/${roomId}`)).status(), "방 정보").toBe(404)
  const read = await page.request.get(`/api/chat/messages?roomId=${roomId}`)
  expect(read.ok(), "글 읽기").toBe(false)
  const write = await page.request.post("/api/chat/messages", { data: { roomId, content: "끼어들기" } })
  expect(write.ok(), "글 쓰기").toBe(false)
  expect((await page.request.post(`/api/chat/people-rooms/${roomId}/members`, { data: { userIds: [await userId(page, "사원3")] } })).status(), "초대").toBe(404)
  const list = await (await page.request.get("/api/chat/rooms")).text()
  expect(list, "방 목록").not.toContain(roomId)
  const search = await page.request.get(`/api/chat/search?roomId=${roomId}&q=${encodeURIComponent(secret)}`)
  expect(await search.text(), "검색").not.toContain(secret)
}

test("「사람과 대화」 에서 나와의 대화를 열어 글을 남기고, 다시 열면 같은 방이다", async ({ page }) => {
  await login(page, "팀장")
  await page.goto("/chat/new/people")
  await page.locator("[data-self-room]").click()
  await page.waitForURL(/\/chat\/(?!new)[^/]+$/, { timeout: 30_000 })
  const roomId = page.url().split("/").pop()!
  await expect(page.getByRole("heading", { name: "나와의 대화" })).toBeVisible()
  await expect(page.getByText("나만 보는 방이에요")).toBeVisible()

  const memo = `내 메모 ${Date.now()}`
  const box = page.locator("[data-composer-pill] textarea").first()
  await expect.poll(() => box.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps")))).toBe(true)
  await box.fill(memo)
  await box.press("Enter")
  await expect(page.getByText(memo).first()).toBeVisible()

  const again = await (await page.request.post("/api/chat/self-room")).json()
  expect(again).toMatchObject({ roomId, existing: true })
  const list = await (await page.request.get("/api/chat/rooms")).text()
  expect(list).toContain(roomId)
  expect(list).toContain("나와의 대화")
})

test("거부 — 다른 사람은 나와의 대화에 들어오지 못하고, 자기 방은 따로 열린다", async ({ browser }) => {
  const owner = await as(browser, "팀장")
  const other = await as(browser, "사원2")
  const { roomId } = await (await owner.page.request.post("/api/chat/self-room")).json()
  const secret = `혼자 메모 ${Date.now()}`
  expect((await owner.page.request.post("/api/chat/messages", { data: { roomId, content: secret } })).ok()).toBe(true)

  await expectLockedOut(other.page, roomId, secret)

  const mine = await (await other.page.request.post("/api/chat/self-room")).json()
  expect(mine.roomId).not.toBe(roomId)
  expect(await (await owner.page.request.get(`/api/chat/people-rooms/${roomId}`)).json()).toMatchObject({ self: true, title: "나와의 대화" })
  await owner.ctx.close()
  await other.ctx.close()
})

test("거부 — 남의 1:1 에 들어오지 못한다", async ({ browser }) => {
  const a = await as(browser, "팀장")
  const b = await as(browser, "사원1")
  const outsider = await as(browser, "사원2")
  const res = await a.page.request.post("/api/chat/people-rooms", { data: { userIds: [await userId(a.page, "사원1")] } })
  const { roomId } = await res.json()
  const secret = `둘만 ${Date.now()}`
  expect((await a.page.request.post("/api/chat/messages", { data: { roomId, content: secret } })).ok()).toBe(true)
  expect((await b.page.request.get(`/api/chat/messages?roomId=${roomId}`)).ok(), "상대는 읽는다").toBe(true)
  await expectLockedOut(outsider.page, roomId, secret)
  for (const c of [a, b, outsider]) await c.ctx.close()
})

test("같은 상대의 1:1 은 어느 쪽이 열어도 그 방이고, 단체 대화는 새로 만든다", async ({ browser }) => {
  const a = await as(browser, "팀장")
  const b = await as(browser, "사원3")
  const first = await (await a.page.request.post("/api/chat/people-rooms", { data: { userIds: [await userId(a.page, "사원3")] } })).json()
  const mine = await (await a.page.request.post("/api/chat/people-rooms", { data: { userIds: [await userId(a.page, "사원3")] } })).json()
  const theirs = await (await b.page.request.post("/api/chat/people-rooms", { data: { userIds: [await userId(b.page, "팀장")] } })).json()
  expect(mine).toMatchObject({ roomId: first.roomId, existing: true })
  expect(theirs).toMatchObject({ roomId: first.roomId, existing: true })

  const ids = [await userId(a.page, "사원3"), await userId(a.page, "사원1")]
  const g1 = await (await a.page.request.post("/api/chat/people-rooms", { data: { userIds: ids } })).json()
  const g2 = await (await a.page.request.post("/api/chat/people-rooms", { data: { userIds: ids } })).json()
  expect(g1.existing).toBe(false)
  expect(g2.existing).toBe(false)
  expect(g2.roomId).not.toBe(g1.roomId)
  await a.ctx.close()
  await b.ctx.close()
})

test.describe("격리된 시험 DB 에서만", () => {
  test.skip(process.env.E2E_ISOLATED !== "true", "카톡에서 옮겨 온 방을 DB 에 직접 넣는다")

  test("카톡에서 이식된 1:1 이 있으면 새 방을 만들지 않고 그 방을 연다", async ({ page }) => {
    const prisma = new PrismaClient()
    try {
      await login(page, "부팀장")
      const me = await userId(page, "부팀장")
      const peer = await userId(page, "사원3")
      const dmKey = dmKeyOf(me, peer)
      await prisma.chatRoom.deleteMany({ where: { dmKey } })
      // 이식 도구(import-tools/kakao-common.ts)가 만드는 모양 — id 가 kakao-dm-* 이고 만든 사람이 없다
      const roomId = `kakao-dm-시험-${Date.now()}`
      await prisma.chatRoom.create({
        data: { id: roomId, name: "부팀장, 사원3", kind: "DM", dmKey, members: { create: [{ userId: me }, { userId: peer }] } },
      })
      await page.goto("/chat/new/people")
      const res = await page.request.post("/api/chat/people-rooms", { data: { userIds: [peer] } })
      expect(res.status()).toBe(200)
      expect(await res.json()).toMatchObject({ roomId, kind: "DM", existing: true })
      expect(await prisma.chatRoom.count({ where: { kind: "DM", members: { every: { userId: { in: [me, peer] } } }, dmKey } })).toBe(1)
    } finally {
      await prisma.$disconnect()
    }
  })

  test("거부 — 나와의 대화에 붙은 파일은 다른 사람이 받지 못한다", async ({ browser }) => {
    const prisma = new PrismaClient()
    const owner = await as(browser, "팀장")
    const other = await as(browser, "사원2")
    try {
      const { roomId } = await (await owner.page.request.post("/api/chat/self-room")).json()
      const me = await userId(owner.page, "팀장")
      const message = await prisma.chatMessage.create({ data: { roomId, authorId: me, content: "첨부 시험" } })
      const file = await prisma.file.create({
        data: { name: "메모.png", path: "/x", size: 1, mimeType: "image/png", messageId: message.id, privateToUserId: me },
      })
      expect((await other.page.request.get(`/api/files/${file.id}/raw`)).status()).toBe(404)
      expect((await other.page.request.get(`/api/files/${file.id}`)).ok()).toBe(false)
      expect(await (await other.page.request.get("/api/files")).text()).not.toContain(file.id)
      expect(await (await owner.page.request.get("/api/files")).text()).toContain(file.id)
    } finally {
      await prisma.$disconnect()
      await owner.ctx.close()
      await other.ctx.close()
    }
  })
})
