/**
 * MCP post_message 의 room — 단톡방 · 1:1 · 나와의 대화에 글을 보낸다. 화면과 같은 함수(postPeopleMessage)를 지나므로
 * 방 목록 시각 · 안 읽은 수 · 멘션 알림이 같다. 참여자가 아닌 방에는 ID 를 알아도 못 보낸다(관리자도). 규칙의 단위 시험: lib/chat-room-pick.test.ts
 */
import { createHash, randomBytes } from "node:crypto"
import { expect, test, type APIRequestContext } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import type { DemoUser } from "./_setup"

const NAS = process.env.E2E_FAKE_NAS_URL
const stamp = Date.now()
const ROOM_NAME = `시험 보내기 방 ${stamp}`
const TWIN_A = `시험 쌍둥이 ${stamp} 가`
const TWIN_B = `시험 쌍둥이 ${stamp} 나`

const SENDER: DemoUser = "사원1"
const MATE: DemoUser = "사원3"
const OUTSIDER: DemoUser = "사원2"
const ADMIN_OUTSIDER: DemoUser = "팀장"

test.describe("MCP 글 보내기 — 방", () => {
  const prisma = new PrismaClient()
  const tokens = new Map<DemoUser, string>()
  const ids = new Map<DemoUser, string>()
  const roomIds: string[] = []
  let roomId = ""

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
    const names = [SENDER, MATE, OUTSIDER, ADMIN_OUTSIDER]
    const users = await prisma.user.findMany({ where: { name: { in: names } }, select: { id: true, name: true } })
    for (const n of names) ids.set(n, users.find((u) => u.name === n)!.id)
    const make = async (name: string, members: DemoUser[]) => {
      const r = await prisma.chatRoom.create({
        data: { name, kind: "GROUP", createdById: ids.get(members[0])!, lastMessageAt: new Date(Date.now() - 3_600_000), members: { create: members.map((m) => ({ userId: ids.get(m)!, lastReadAt: new Date() })) } },
      })
      roomIds.push(r.id)
      return r.id
    }
    roomId = await make(ROOM_NAME, [SENDER, MATE])
    await make(TWIN_A, [SENDER, MATE])
    await make(TWIN_B, [SENDER, MATE])
    for (const name of names) {
      const token = `hadd_${randomBytes(24).toString("hex")}`
      const hash = createHash("sha256").update(token).digest("hex")
      await prisma.$executeRaw`INSERT INTO ip.mcp_tokens (user_id, name, token_hash, prefix) VALUES (${ids.get(name)!}, ${`시험 보내기 ${stamp}`}, ${hash}, ${token.slice(0, 12)})`
      tokens.set(name, token)
    }
  })

  test.afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM ip.mcp_tokens WHERE name = ${`시험 보내기 ${stamp}`}`
    await prisma.notification.deleteMany({ where: { content: { contains: String(stamp) } } })
    await prisma.file.deleteMany({ where: { name: { contains: String(stamp) } } })
    await prisma.chatMessage.deleteMany({ where: { content: { contains: String(stamp) } } })
    await prisma.chatRoom.deleteMany({ where: { id: { in: roomIds } } })
    await prisma.$disconnect()
  })

  // 지키는 것: 참여자는 방 이름으로 단톡방에 글을 보내고, 화면처럼 방 목록 시각 · 상대의 안 읽은 수 · 멘션 알림이 따라온다
  test("참여자는 이름으로 단톡방에 보낸다 — 안 읽은 수 · 멘션 알림", async ({ request }) => {
    const before = await prisma.chatRoom.findUniqueOrThrow({ where: { id: roomId }, select: { lastMessageAt: true } })
    const line = `@사원3 확인 부탁 ${stamp}`
    const r = await call(request, SENDER, "post_message", { room: ROOM_NAME, content: line })
    expect(r.isError, r.text).toBe(false)
    expect(r.text).toContain(`「${ROOM_NAME}」 에 올렸습니다`)

    const msg = await prisma.chatMessage.findFirstOrThrow({ where: { roomId, content: line }, select: { authorId: true } })
    expect(msg.authorId).toBe(ids.get(SENDER))
    const after = await prisma.chatRoom.findUniqueOrThrow({ where: { id: roomId }, select: { lastMessageAt: true } })
    expect(after.lastMessageAt!.getTime()).toBeGreaterThan(before.lastMessageAt!.getTime())

    const mate = await call(request, MATE, "list_rooms", { query: ROOM_NAME })
    expect(mate.text).toContain("안 읽음 1")
    const mention = await prisma.notification.findFirst({ where: { userId: ids.get(MATE)!, type: "chat_mention", content: { contains: String(stamp) } } })
    expect(mention, "멘션 알림").not.toBeNull()
  })

  // 지키는 것: room="me" 는 내 「나와의 대화」 에 간다(없으면 연다)
  test("room=me 는 나와의 대화", async ({ request }) => {
    const line = `나에게 메모 ${stamp}`
    const r = await call(request, SENDER, "post_message", { room: "me", content: line })
    expect(r.isError, r.text).toBe(false)
    expect(r.text).toContain("「나와의 대화」 에 올렸습니다")
    const msg = await prisma.chatMessage.findFirstOrThrow({ where: { content: line }, select: { room: { select: { kind: true, members: { select: { userId: true } } } } } })
    expect(msg.room.kind).toBe("DM")
    expect(msg.room.members.map((m) => m.userId)).toEqual([ids.get(SENDER)])
  })

  // 지키는 것: 참여자가 아니면 방 ID 를 알아도 못 보내고, 방이 있다는 것도 새지 않는다 — 관리자도 같다
  for (const who of [OUTSIDER, ADMIN_OUTSIDER]) {
    test(`방 밖 사람(${who})은 ID · 이름으로 못 보낸다`, async ({ request }) => {
      for (const room of [roomId, ROOM_NAME]) {
        const r = await call(request, who, "post_message", { room, content: `침입 ${who} ${stamp}` })
        expect(r.isError).toBe(true)
        expect(r.text).toContain("내가 참여자가 아닌 방")
        // ID 로 물었을 때 방 이름이 답에 나오면 방이 있다는 것이 샌다
        if (room === roomId) expect(r.text).not.toContain(ROOM_NAME)
      }
      expect(await prisma.chatMessage.count({ where: { content: { startsWith: `침입 ${who}` } } })).toBe(0)
    })
  }

  // 지키는 것: 이름이 여러 방에 맞으면 보내지 않고 후보(방 ID)를 돌려준다
  test("이름이 여러 방에 맞으면 고르지 않는다", async ({ request }) => {
    const r = await call(request, SENDER, "post_message", { room: `시험 쌍둥이 ${stamp}`, content: `어느 방 ${stamp}` })
    expect(r.isError).toBe(true)
    expect(r.text).toContain("2개라 보내지 않았습니다")
    expect(r.text).toContain(TWIN_A)
    expect(r.text).toContain(TWIN_B)
    expect(await prisma.chatMessage.count({ where: { content: `어느 방 ${stamp}` } })).toBe(0)
  })

  // 지키는 것: 업무 스레드(task)는 전사방에만 — 단톡방 글에 업무 재구성이 붙지 않는다
  test("room 과 task 를 함께 주면 거절", async ({ request }) => {
    const r = await call(request, SENDER, "post_message", { room: ROOM_NAME, task: "아무 업무", content: `업무와 함께 ${stamp}` })
    expect(r.isError).toBe(true)
    expect(r.text).toContain("task 를 빼세요")
  })

  // 지키는 것: 방에 붙일 파일은 올릴 때 room 을 줘야 하고, 그러면 붙은 뒤 그 방 참여자만 본다. 전사방용으로 올린 파일은 방 글에 안 붙는다
  test("방 첨부 — room 을 주고 올린 파일만 붙는다", async ({ request }) => {
    test.skip(!NAS, "가짜 NAS 가 없다(E2E_FAKE_NAS_URL)")
    const pub = await call(request, SENDER, "upload_file", { name: `공개-${stamp}.txt`, content: "공개" })
    const pubId = /파일 ID ([0-9a-f-]{36})/.exec(pub.text)![1]
    const refused = await call(request, SENDER, "post_message", { room: ROOM_NAME, content: `공개 파일 붙이기 ${stamp}`, files: [pubId] })
    expect(refused.isError).toBe(true)
    expect(refused.text).toContain("같은 room 을 주고 올려야")

    const mine = await call(request, SENDER, "upload_file", { name: `방-${stamp}.txt`, content: "방 첨부", room: ROOM_NAME })
    expect(mine.text).toContain(`「${ROOM_NAME}」 에 붙일 파일`)
    const mineId = /파일 ID ([0-9a-f-]{36})/.exec(mine.text)![1]
    const posted = await call(request, SENDER, "post_message", { room: ROOM_NAME, content: `방 첨부 글 ${stamp}`, files: [mineId] })
    expect(posted.isError, posted.text).toBe(false)
    expect(posted.text).toContain(`방-${stamp}.txt`)
    const file = await prisma.file.findUniqueOrThrow({ where: { id: mineId }, select: { privateToUserId: true, message: { select: { roomId: true } } } })
    expect(file.privateToUserId).toBe(ids.get(SENDER))
    expect(file.message?.roomId).toBe(roomId)
    // 방 밖 사람은 그 파일을 못 읽는다
    const peek = await call(request, OUTSIDER, "read_file", { file: mineId })
    expect(peek.isError).toBe(true)
  })

  // 지키는 것: 업로드 링크 응답이 큰 파일 절차(R2 조각 업로드)를 안내하고, room 을 주면 그 방용 링크가 된다
  test("create_upload_link — 큰 파일 절차와 방 링크", async ({ request }) => {
    const r = await call(request, SENDER, "create_upload_link", { room: "me" })
    expect(r.isError, r.text).toBe(false)
    expect(r.text).toContain("「나와의 대화」 에 붙일 파일")
    expect(r.text).toMatch(/MB 초과/)
  })
})
