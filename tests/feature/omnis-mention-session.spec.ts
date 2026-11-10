/**
 * 단톡방 · 1:1 의 @옴니스 — 언급 뒤 글로 세션을 열고, 방에는 시작 · 끝 안내 한 줄, 「열기」 로 세션에 간다.
 * 세션은 그 방 참여자 모두가 보고 이어 묻는다(참여자 행을 방과 같게 둔다). 방 밖 사람에게는 어느 길로도 없다.
 * 확인 카드는 그 실행을 연 사람만 누른다. 규칙의 단위 시험: lib/omnis-mention-rules.test.ts
 *
 * 옴니스 실행은 시험 모델(OMNIS_AGENT_FAKE=1, lib/agent/fake-model.ts)이 되받아 답한다 — Workflow · 저장 · 안내는 실제 경로다.
 * 시험 DB 를 직접 읽고 쓰므로 로컬 DB(CI · e2e-local)에서만 돈다. MENTION_SHOTS 에 절대 경로를 주면 화면을 남긴다.
 */
import { createHash, randomBytes } from "node:crypto"
import { expect, test, type Browser, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { login, type DemoUser } from "./_setup"

const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")
test.skip(!LOCAL_DB, "시험 DB 를 직접 읽고 쓴다")

const prisma = LOCAL_DB ? new PrismaClient() : (null as unknown as PrismaClient)
const shots = process.env.MENTION_SHOTS
const stamp = Date.now()
const ROOM_NAME = `옴니스 부르기 ${stamp}`
const PROMPT = `이번 주 마감 업무 정리해 줘 ${stamp}`
const FOLLOW = `담당자별로 다시 묶어 줘 ${stamp}`

const REQUESTER: DemoUser = "팀장"
const MEMBER: DemoUser = "사원1"
const LEAVER: DemoUser = "사원2"
const OUTSIDER: DemoUser = "사원3"

const PHONE = { viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }

async function as(browser: Browser, name: DemoUser, phone = false) {
  const ctx = await browser.newContext(phone ? PHONE : { viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(() => {
    localStorage.setItem("omnis:nudge-off:install", "1")
    localStorage.setItem("omnis:nudge-off:push", "1")
  })
  const page = await ctx.newPage()
  await login(page, name)
  return { ctx, page }
}

async function send(page: Page, text: string) {
  const box = page.locator("[data-composer-pill] textarea").first()
  await expect.poll(() => box.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps")))).toBe(true)
  await box.fill(text)
  await box.press("Enter")
}

async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` })
}

test.describe("@옴니스 로 부르기 · 세션 공유 @chat", () => {
  let roomId = ""
  let sessionId = ""
  const ids = new Map<DemoUser, string>()

  test.beforeAll(async () => {
    const users = await prisma.user.findMany({ where: { name: { in: [REQUESTER, MEMBER, LEAVER, OUTSIDER] } }, select: { id: true, name: true } })
    for (const u of users) ids.set(u.name as DemoUser, u.id)
    const room = await prisma.chatRoom.create({
      data: {
        name: ROOM_NAME, kind: "GROUP", createdById: ids.get(REQUESTER)!, lastMessageAt: new Date(),
        members: { create: [REQUESTER, MEMBER, LEAVER].map((n) => ({ userId: ids.get(n)! })) },
      },
    })
    roomId = room.id
    await prisma.chatMessage.create({ data: { roomId, authorId: ids.get(MEMBER)!, content: "이번 주 일정 공유드려요" } })
  })

  test.afterAll(async () => {
    await prisma?.$disconnect()
  })

  // 지키는 것: 단톡방에서 @옴니스 로 부르면 방에 시작 · 끝 안내만 남고, 「열기」 로 그 답이 든 세션에 간다
  test("언급 → 세션 생성 → 완료 안내 → 열기로 이동", async ({ browser }) => {
    const { ctx, page } = await as(browser, REQUESTER)
    await page.goto(`/chat/${roomId}`)
    await send(page, `@옴니스 ${PROMPT}`)

    const start = page.locator("[data-system-pill]").filter({ hasText: `옴니스가 ${REQUESTER}님의 요청을 처리하고 있어요` })
    await expect(start).toBeVisible({ timeout: 20_000 })
    const done = page.locator("[data-system-pill]").filter({ hasText: "옴니스 답 · 시험 답입니다" })
    await expect(done).toBeVisible({ timeout: 45_000 })
    // 긴 답은 방에 붙지 않는다 — 요약 한 줄만
    await expect(page.getByText("실제 모델은 부르지 않았습니다")).toHaveCount(0)
    await shot(page, "pc-room-notice")

    await done.locator("[data-omnis-session-link]").click()
    await page.waitForURL(/\/chat\/(?!new)[^/]+$/, { timeout: 15_000 })
    sessionId = page.url().split("/").pop()!
    expect(sessionId).not.toBe(roomId)
    await expect(page.getByText(PROMPT).first()).toBeVisible()
    await expect(page.getByText("실제 모델은 부르지 않았습니다").first()).toBeVisible()
    await expect(page.getByText(`공유됨 · ${ROOM_NAME}`).first()).toBeVisible()
    await shot(page, "pc-session")

    // 실행 · 비용의 주인은 부른 사람이다
    const runs = await prisma.agentRun.findMany({ where: { roomId: sessionId }, select: { userId: true, status: true, notifyOrigin: true } })
    expect(runs).toEqual([{ userId: ids.get(REQUESTER), status: "DONE", notifyOrigin: false }])
    // 안내는 시작 · 끝 두 줄뿐이고 둘 다 세션을 가리킨다
    const notices = await prisma.chatMessage.findMany({ where: { roomId, sessionRoomId: { not: null } }, select: { sessionRoomId: true } })
    expect(notices.map((n) => n.sessionRoomId)).toEqual([sessionId, sessionId])
    await ctx.close()
  })

  // 지키는 것: 방 참여자는 공유 세션을 목록에서 알아보고 열어 이어 물을 수 있다 — 그 질문은 그 사람 몫이다
  test("참여자 — 목록의 「공유됨」 · 남의 글 이름 · 이어 묻기", async ({ browser }) => {
    test.skip(!sessionId, "앞 시험이 세션을 만들지 못했다")
    const { ctx, page } = await as(browser, MEMBER, true)
    const list = (await (await page.request.get("/api/chat/rooms")).json()) as { omnis: { id: string; sharedFrom?: string }[] }
    expect(list.omnis.find((r) => r.id === sessionId)?.sharedFrom).toBe(ROOM_NAME)
    await page.goto("/chat")
    await expect(page.locator("[data-shared-from]").filter({ hasText: ROOM_NAME }).first()).toBeVisible({ timeout: 15_000 })
    await shot(page, "phone-list")

    await page.goto(`/chat/${sessionId}`)
    const peer = page.locator("[data-peer-message]").filter({ hasText: PROMPT })
    await expect(peer).toBeVisible()
    await expect(peer).toContainText(REQUESTER)
    await send(page, FOLLOW)
    await expect(page.getByText(`「${FOLLOW}」 를 받았어요`).first()).toBeVisible({ timeout: 45_000 })
    await shot(page, "phone-session")

    const runs = await prisma.agentRun.findMany({ where: { roomId: sessionId }, orderBy: { createdAt: "asc" }, select: { userId: true, notifyOrigin: true } })
    expect(runs.map((r) => r.userId)).toEqual([ids.get(REQUESTER), ids.get(MEMBER)])
    // 이어 묻기는 방에 다시 알리지 않는다
    expect(runs[1].notifyOrigin).toBe(false)
    await ctx.close()
  })

  // 지키는 것: 쓰기 확인 카드는 그 실행을 연 사람만 누른다 — 다른 참여자는 보기만 하고, API 로도 못 누른다
  test("확인 카드는 요청자만", async ({ browser }) => {
    test.skip(!sessionId, "앞 시험이 세션을 만들지 못했다")
    const q = await prisma.chatMessage.create({ data: { roomId: sessionId, authorId: ids.get(REQUESTER)!, content: `업무 하나 만들어 줘 ${stamp}` } })
    const run = await prisma.agentRun.create({
      data: { roomId: sessionId, userId: ids.get(REQUESTER)!, questionMessageId: q.id, status: "AWAITING_APPROVAL", model: "openai:test", messages: [] },
    })
    const step = await prisma.agentStep.create({
      data: {
        runId: run.id, toolCallId: `call-${stamp}`, approvalId: `ap-${stamp}`, toolName: "create_task", input: { name: "시험 업무" },
        preview: { title: "업무 만들기", target: `시험 업무 ${stamp}`, changes: [], risk: "" }, planHash: `hash-${stamp}`,
      },
    })

    const member = await as(browser, MEMBER, true)
    await member.page.goto(`/chat/${sessionId}`)
    const card = member.page.locator("[data-agent-card=PENDING]")
    await expect(card).toBeVisible()
    await expect(card.locator("[data-agent-card-locked]")).toHaveText(`요청한 ${REQUESTER}님만 확인할 수 있어요`)
    await expect(card.getByRole("button", { name: "확인" })).toHaveCount(0)
    await shot(member.page, "phone-card-locked")
    const tried = await member.page.request.post(`/api/agent/steps/${step.id}`, { data: { decision: "approve", planHash: `hash-${stamp}` } })
    expect(tried.ok()).toBe(false)
    expect((await prisma.agentStep.findUniqueOrThrow({ where: { id: step.id } })).status).toBe("PENDING")
    await member.ctx.close()

    const owner = await as(browser, REQUESTER)
    await owner.page.goto(`/chat/${sessionId}`)
    const mine = owner.page.locator("[data-agent-card=PENDING]")
    await expect(mine.getByRole("button", { name: "확인" })).toBeVisible()
    await expect(mine.locator("[data-agent-card-locked]")).toHaveCount(0)
    await owner.ctx.close()
    // 다음 시험이 이 실행을 기다리지 않게 치운다
    await prisma.agentRun.delete({ where: { id: run.id } })
  })

  // 지키는 것: 방 밖 사람에게 공유 세션은 화면 · API · 목록 · MCP 어느 길로도 없다
  test("방 밖 사람은 세션을 못 본다 · MCP 도 같다", async ({ browser, request }) => {
    test.skip(!sessionId, "앞 시험이 세션을 만들지 못했다")
    const { ctx, page } = await as(browser, OUTSIDER)
    await page.goto(`/chat/${sessionId}`)
    await expect(page.getByText(PROMPT)).toHaveCount(0)
    expect((await page.request.get(`/api/agent/rooms/${sessionId}`)).status()).toBe(404)
    expect((await page.request.post(`/api/agent/rooms/${sessionId}`, { data: { content: "끼어들기" } })).status()).toBe(404)
    expect(await (await page.request.get("/api/chat/rooms")).text()).not.toContain(sessionId)
    await ctx.close()

    const tokens = new Map<DemoUser, string>()
    for (const who of [MEMBER, OUTSIDER] as const) {
      const token = `hadd_${randomBytes(24).toString("hex")}`
      const hash = createHash("sha256").update(token).digest("hex")
      await prisma.$executeRaw`INSERT INTO ip.mcp_tokens (user_id, name, token_hash, prefix) VALUES (${ids.get(who)!}, ${`시험 ${stamp}`}, ${hash}, ${token.slice(0, 12)})`
      tokens.set(who, token)
    }
    const read = async (who: DemoUser) => {
      const res = await request.post("/api/ip-mcp", {
        headers: { authorization: `Bearer ${tokens.get(who)}` },
        data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_chat", arguments: { view: "room", room: sessionId } } },
      })
      const body = (await res.json()) as { result?: { content?: { text: string }[] } }
      return body.result?.content?.map((c) => c.text).join("\n") ?? ""
    }
    expect(await read(MEMBER)).toContain(PROMPT)
    expect(await read(OUTSIDER)).not.toContain(PROMPT)
    await prisma.$executeRaw`DELETE FROM ip.mcp_tokens WHERE name = ${`시험 ${stamp}`}`
  })

  // 지키는 것: 방을 나가면 그 방에서 연 세션도 그 순간부터 못 본다
  test("방을 나가면 세션도 못 본다", async ({ browser }) => {
    test.skip(!sessionId, "앞 시험이 세션을 만들지 못했다")
    const { ctx, page } = await as(browser, LEAVER)
    expect((await page.request.get(`/api/agent/rooms/${sessionId}`)).status()).toBe(200)
    expect((await page.request.post(`/api/chat/people-rooms/${roomId}/leave`)).ok()).toBe(true)
    expect((await page.request.get(`/api/agent/rooms/${sessionId}`)).status()).toBe(404)
    expect(await (await page.request.get("/api/chat/rooms")).text()).not.toContain(sessionId)
    await ctx.close()
  })
})
