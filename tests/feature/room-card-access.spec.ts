/**
 * 참여자 전용 방의 글이 업무 카드에 연결돼도 그 방 사람에게만 보인다.
 * 카드 자체(이름 · 전사방 글 · 공개 첨부)는 누구에게나 그대로다. 관리자 예외는 없다.
 * AI 입력 · 검색 근거(HTTP 로 볼 수 없는 경로)는 scripts/verify-room-card-access.ts 가 본다.
 */
import { createHash, randomBytes } from "node:crypto"
import { expect, test, type Browser, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { login, type DemoUser } from "./_setup"

const COMPANY_ROOM_ID = "default-room"
const stamp = Date.now()
const CARD = `방 권한 시험 카드 ${stamp}`
const PUBLIC_LINE = `전사방 예시 문장 ${stamp}`
const ROOM_LINE = `단톡방 예시 문장 ${stamp}`
const PUBLIC_FILE = `전사-예시-${stamp}.txt`
const ROOM_FILE = `단톡-예시-${stamp}.txt`

const MEMBER: DemoUser = "사원1"
const OUTSIDER: DemoUser = "사원2"
const ADMIN_OUTSIDER: DemoUser = "팀장"

test.describe("업무 카드에 연결된 글의 방 권한", () => {
  const prisma = new PrismaClient()
  let taskId = ""
  let roomId = ""
  let publicFileId = ""
  let roomFileId = ""
  const tokens = new Map<DemoUser, string>()

  async function as(browser: Browser, name: DemoUser, run: (page: Page) => Promise<void>) {
    const ctx = await browser.newContext()
    try {
      const page = await ctx.newPage()
      await login(page, name)
      await run(page)
    } finally {
      await ctx.close()
    }
  }

  async function getTask(page: Page, name: DemoUser) {
    const res = await page.request.post("/api/ip-mcp", {
      headers: { authorization: `Bearer ${tokens.get(name)}` },
      data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_task", arguments: { task: taskId } } },
    })
    expect(res.ok(), "MCP 응답").toBe(true)
    const body = (await res.json()) as { result?: { content?: { text: string }[]; isError?: boolean } }
    expect(body.result?.isError ?? false, "MCP 오류").toBe(false)
    return body.result?.content?.[0]?.text ?? ""
  }

  test.beforeAll(async () => {
    const users = await prisma.user.findMany({ where: { name: { in: [MEMBER, OUTSIDER, ADMIN_OUTSIDER] } }, select: { id: true, name: true } })
    const idOf = (name: DemoUser) => users.find((u) => u.name === name)!.id
    const task = await prisma.task.create({ data: { name: CARD, slug: `room-access-${stamp}`, instructorId: idOf(ADMIN_OUTSIDER), background: "시험 카드 본문" } })
    taskId = task.id
    const room = await prisma.chatRoom.create({ data: { name: `시험 단톡 ${stamp}`, kind: "GROUP", members: { create: { userId: idOf(MEMBER) } } } })
    roomId = room.id
    const inCompany = await prisma.chatMessage.create({ data: { roomId: COMPANY_ROOM_ID, authorId: idOf(ADMIN_OUTSIDER), content: PUBLIC_LINE, taskId } })
    const inRoom = await prisma.chatMessage.create({ data: { roomId, authorId: idOf(MEMBER), content: ROOM_LINE, taskId } })
    publicFileId = (await prisma.file.create({ data: { name: PUBLIC_FILE, path: "/x", size: 1, mimeType: "text/plain", messageId: inCompany.id, taskId } })).id
    roomFileId = (await prisma.file.create({ data: { name: ROOM_FILE, path: "/x", size: 1, mimeType: "text/plain", messageId: inRoom.id, privateToUserId: idOf(MEMBER) } })).id
    for (const name of [MEMBER, OUTSIDER, ADMIN_OUTSIDER]) {
      const token = `hadd_${randomBytes(24).toString("hex")}`
      const hash = createHash("sha256").update(token).digest("hex")
      await prisma.$executeRaw`INSERT INTO ip.mcp_tokens (user_id, name, token_hash, prefix) VALUES (${idOf(name)}, ${`시험 ${stamp}`}, ${hash}, ${token.slice(0, 12)})`
      tokens.set(name, token)
    }
  })

  test.afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM ip.mcp_tokens WHERE name = ${`시험 ${stamp}`}`
    await prisma.file.deleteMany({ where: { id: { in: [publicFileId, roomFileId] } } })
    await prisma.chatMessage.deleteMany({ where: { taskId } })
    await prisma.chatRoom.delete({ where: { id: roomId } })
    await prisma.task.delete({ where: { id: taskId } })
    await prisma.$disconnect()
  })

  for (const viewer of [OUTSIDER, ADMIN_OUTSIDER]) {
    test(`방 밖 사람(${viewer})에게 단톡 글 · 첨부가 어느 카드 경로로도 오지 않고 카드는 그대로다`, async ({ browser }) => {
      await as(browser, viewer, async (page) => {
        const api = await page.request.get(`/api/tasks/${taskId}`)
        expect(api.status(), "업무 API").toBe(200)
        const task = (await api.json()) as { name: string; background: string; messages: { content: string; roomId: string }[] }
        expect(task.name, "카드 이름").toBe(CARD)
        expect(task.background, "카드 본문").toBe("시험 카드 본문")
        expect(task.messages.map((m) => m.content), "업무 API 글").toEqual([PUBLIC_LINE])

        const list = (await (await page.request.get("/api/tasks")).json()) as { id: string; _count: { messages: number; files: number } }[]
        expect(list.find((t) => t.id === taskId)?._count.messages, "목록의 글 수").toBe(1)

        const screen = await (await page.request.get(`/tasks/${taskId}`)).text()
        expect(screen, "카드 화면에 전사방 글").toContain(PUBLIC_LINE)
        expect(screen, "카드 화면에 전사방 첨부").toContain(PUBLIC_FILE)
        expect(screen, "카드 화면에 단톡 글").not.toContain(ROOM_LINE)
        expect(screen, "카드 화면에 단톡 첨부").not.toContain(ROOM_FILE)
        await page.goto(`/tasks/${taskId}`)
        await expect(page.getByRole("heading", { name: CARD }).first(), "카드가 열린다").toBeVisible()

        const mcp = await getTask(page, viewer)
        expect(mcp, "get_task 카드 이름").toContain(CARD)
        expect(mcp, "get_task 전사방 글").toContain(PUBLIC_LINE)
        expect(mcp, "get_task 전사방 첨부").toContain(publicFileId)
        expect(mcp, "get_task 단톡 글").not.toContain(ROOM_LINE)
        expect(mcp, "get_task 단톡 첨부").not.toContain(roomFileId)

        expect((await page.request.get(`/api/files/${roomFileId}`)).ok(), "단톡 첨부 정보").toBe(false)
        expect([403, 404], "단톡 첨부 내려받기").toContain((await page.request.get(`/api/files/${roomFileId}/raw`)).status())
        expect(await (await page.request.get("/api/files")).text(), "첨부 목록").not.toContain(roomFileId)
      })
    })
  }

  test("참여자에게는 카드 경로에서 단톡 글 · 첨부가 지금처럼 보인다", async ({ browser }) => {
    await as(browser, MEMBER, async (page) => {
      const task = (await (await page.request.get(`/api/tasks/${taskId}`)).json()) as { messages: { content: string }[] }
      expect(task.messages.map((m) => m.content).sort(), "업무 API 글").toEqual([PUBLIC_LINE, ROOM_LINE].sort())

      const list = (await (await page.request.get("/api/tasks")).json()) as { id: string; _count: { messages: number } }[]
      expect(list.find((t) => t.id === taskId)?._count.messages, "목록의 글 수").toBe(2)

      const screen = await (await page.request.get(`/tasks/${taskId}`)).text()
      expect(screen, "카드 화면에 단톡 글").toContain(ROOM_LINE)
      expect(screen, "카드 화면에 단톡 첨부").toContain(ROOM_FILE)

      const mcp = await getTask(page, MEMBER)
      expect(mcp, "get_task 단톡 글").toContain(ROOM_LINE)
      expect(mcp, "get_task 단톡 첨부").toContain(roomFileId)
      expect(await (await page.request.get("/api/files")).text(), "첨부 목록").toContain(roomFileId)
    })
  })

  test("방을 나간 사람은 그 순간부터 카드에서도 단톡 글을 못 본다", async ({ browser }) => {
    const member = await prisma.user.findFirstOrThrow({ where: { name: MEMBER }, select: { id: true } })
    await prisma.chatRoomMember.delete({ where: { roomId_userId: { roomId, userId: member.id } } })
    try {
      await as(browser, MEMBER, async (page) => {
        const task = (await (await page.request.get(`/api/tasks/${taskId}`)).json()) as { messages: { content: string }[] }
        expect(task.messages.map((m) => m.content)).toEqual([PUBLIC_LINE])
      })
    } finally {
      await prisma.chatRoomMember.create({ data: { roomId, userId: member.id } })
    }
  })
})
