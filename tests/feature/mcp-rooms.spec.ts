/**
 * MCP 방 읽기(list_rooms · list_chat view=room)는 그 방 참여자에게만 열린다 — #160 의 방 권한(roomAccess)과 같은 규칙.
 * 방 밖 사람은 일반 구성원이든 관리자든 방 ID · 이름 · 참여자 구성 어느 것으로도 글을 못 읽고, 방이 있다는 것도 보이지 않는다.
 * 방을 나가면 그 순간부터 못 읽는다.
 */
import { createHash, randomBytes } from "node:crypto"
import { expect, test, type APIRequestContext } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import type { DemoUser } from "./_setup"

const COMPANY_ROOM_ID = "default-room"
const stamp = Date.now()
const ROOM_NAME = `시험 방 읽기 ${stamp}`
const ROOM_LINE = `단톡방 글 ${stamp}`
const ROOM_OTHER = `단톡방 다른 글 ${stamp}`
const ROOM_OLD = `단톡방 옛 글 ${stamp}`
const ROOM_FILE = `단톡-첨부-${stamp}.txt`
const PUBLIC_LINE = `전사방 글 ${stamp}`

const MEMBER: DemoUser = "사원1"
const MEMBER2: DemoUser = "사원3"
const MEMBER3: DemoUser = "부팀장"
const OUTSIDER: DemoUser = "사원2"
const ADMIN_OUTSIDER: DemoUser = "팀장"

test.describe("MCP 방 읽기의 방 권한", () => {
  const prisma = new PrismaClient()
  let roomId = ""
  let fileId = ""
  const tokens = new Map<DemoUser, string>()

  async function call(request: APIRequestContext, who: DemoUser, name: string, args: Record<string, unknown>) {
    const res = await request.post("/api/ip-mcp", {
      headers: { authorization: `Bearer ${tokens.get(who)}` },
      data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
    })
    expect(res.ok(), "MCP 응답").toBe(true)
    const body = (await res.json()) as { result?: { content?: { text: string }[]; isError?: boolean } }
    return { text: body.result?.content?.map((c) => c.text).join("\n") ?? "", isError: body.result?.isError ?? false }
  }

  test.beforeAll(async () => {
    const names = [MEMBER, MEMBER2, MEMBER3, OUTSIDER, ADMIN_OUTSIDER]
    const users = await prisma.user.findMany({ where: { name: { in: names } }, select: { id: true, name: true } })
    const idOf = (name: DemoUser) => users.find((u) => u.name === name)!.id
    const room = await prisma.chatRoom.create({
      data: {
        name: ROOM_NAME, kind: "GROUP", createdById: idOf(MEMBER), lastMessageAt: new Date(),
        members: { create: [MEMBER, MEMBER2, MEMBER3].map((n) => ({ userId: idOf(n) })) },
      },
    })
    roomId = room.id
    await prisma.chatMessage.create({ data: { roomId, authorId: idOf(MEMBER2), content: ROOM_OLD, createdAt: new Date("2026-01-02T03:00:00Z") } })
    const line = await prisma.chatMessage.create({ data: { roomId, authorId: idOf(MEMBER), content: ROOM_LINE } })
    await prisma.chatMessage.create({ data: { roomId, authorId: idOf(MEMBER3), content: ROOM_OTHER } })
    await prisma.chatMessage.create({ data: { roomId: COMPANY_ROOM_ID, authorId: idOf(MEMBER), content: PUBLIC_LINE } })
    fileId = (await prisma.file.create({ data: { name: ROOM_FILE, path: "/x", size: 1, mimeType: "text/plain", messageId: line.id, privateToUserId: idOf(MEMBER) } })).id
    for (const name of names) {
      const token = `hadd_${randomBytes(24).toString("hex")}`
      const hash = createHash("sha256").update(token).digest("hex")
      await prisma.$executeRaw`INSERT INTO ip.mcp_tokens (user_id, name, token_hash, prefix) VALUES (${idOf(name)}, ${`시험 ${stamp}`}, ${hash}, ${token.slice(0, 12)})`
      tokens.set(name, token)
    }
  })

  test.afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM ip.mcp_tokens WHERE name = ${`시험 ${stamp}`}`
    await prisma.file.deleteMany({ where: { id: fileId } })
    await prisma.chatMessage.deleteMany({ where: { OR: [{ roomId }, { content: PUBLIC_LINE }] } })
    await prisma.chatRoom.delete({ where: { id: roomId } })
    await prisma.$disconnect()
  })

  test("참여자는 방 목록에서 방을 보고 이름 · 참여자 구성으로 글을 읽는다", async ({ request }) => {
    const rooms = await call(request, MEMBER, "list_rooms", {})
    expect(rooms.isError).toBe(false)
    const row = rooms.text.split("\n").find((l) => l.includes(ROOM_NAME)) ?? ""
    expect(row, "방 줄").toContain("단톡방")
    expect(row, "참여자 이름").toContain(MEMBER2)
    expect(row, "방 ID").toContain(roomId)

    const byName = await call(request, MEMBER, "list_chat", { view: "room", room: ROOM_NAME })
    expect(byName.isError).toBe(false)
    expect(byName.text).toContain(ROOM_LINE)
    expect(byName.text, "첨부는 이름 (ID)").toContain(`[첨부: ${ROOM_FILE} (${fileId})]`)

    // 정확히 그 구성 — 나는 빼고 준다
    const byMembers = await call(request, MEMBER, "list_chat", { view: "room", members: [MEMBER2, MEMBER3] })
    expect(byMembers.isError).toBe(false)
    expect(byMembers.text).toContain(ROOM_LINE)
    // 구성이 다르면 그 방이 아니다
    const fewer = await call(request, MEMBER, "list_chat", { view: "room", members: [MEMBER2] })
    expect(fewer.text).not.toContain(ROOM_LINE)

    const searched = await call(request, MEMBER, "list_chat", { view: "room", room: roomId, query: "다른 글" })
    expect(searched.text).toContain(ROOM_OTHER)
    expect(searched.text).not.toContain(ROOM_LINE)

    const recent = await call(request, MEMBER, "list_chat", { view: "room", room: roomId, since: "2026-06-01" })
    expect(recent.text).toContain(ROOM_LINE)
    expect(recent.text, "since 앞의 글").not.toContain(ROOM_OLD)
    const old = await call(request, MEMBER, "list_chat", { view: "room", room: roomId, until: "2026-01-02" })
    expect(old.text).toContain(ROOM_OLD)
    expect(old.text, "until 뒤의 글").not.toContain(ROOM_LINE)
  })

  for (const viewer of [OUTSIDER, ADMIN_OUTSIDER]) {
    test(`방 밖 사람(${viewer})은 ID · 이름 · 참여자 구성 어느 것으로도 못 읽고 방 목록에도 없다`, async ({ request }) => {
      const rooms = await call(request, viewer, "list_rooms", {})
      expect(rooms.text, "방 목록에 이름").not.toContain(ROOM_NAME)
      expect(rooms.text, "방 목록에 ID").not.toContain(roomId)

      for (const args of [{ room: roomId }, { room: ROOM_NAME }, { members: [MEMBER, MEMBER2, MEMBER3] }]) {
        const r = await call(request, viewer, "list_chat", { view: "room", ...args })
        expect(r.isError, JSON.stringify(args)).toBe(true)
        expect(r.text, "글").not.toContain(ROOM_LINE)
        expect(r.text, "방 이름").not.toContain(ROOM_NAME)
        expect(r.text, "첨부").not.toContain(fileId)
      }
      // 전사방 보기는 지금처럼 — 방 글은 섞이지 않는다
      const all = await call(request, viewer, "list_chat", { view: "all", limit: 200 })
      expect(all.text).toContain(PUBLIC_LINE)
      expect(all.text).not.toContain(ROOM_LINE)
      const company = await call(request, viewer, "list_chat", { view: "room", room: COMPANY_ROOM_ID })
      expect(company.isError, "전사방은 누구나").toBe(false)
      expect(company.text).toContain(PUBLIC_LINE)
    })
  }

  test("방을 나간 사람은 그 순간부터 못 읽는다", async ({ request }) => {
    const member = await prisma.user.findFirstOrThrow({ where: { name: MEMBER }, select: { id: true } })
    await prisma.chatRoomMember.delete({ where: { roomId_userId: { roomId, userId: member.id } } })
    try {
      const r = await call(request, MEMBER, "list_chat", { view: "room", room: roomId })
      expect(r.isError).toBe(true)
      expect(r.text).not.toContain(ROOM_LINE)
      expect((await call(request, MEMBER, "list_rooms", {})).text).not.toContain(roomId)
    } finally {
      await prisma.chatRoomMember.create({ data: { roomId, userId: member.id } })
    }
  })
})
