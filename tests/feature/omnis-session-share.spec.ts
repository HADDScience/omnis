/**
 * 옴니스 세션 수동 공유 · 해제 · 인계(2026-11-11, lib/omnis-session-share.ts). #190 @옴니스 세션 공유의 확장.
 * 볼 수 있는 사람 = 세션 참여자 행 — 사람 공유 · 방 공유 · 해제 · 인계가 그 행을 바꾼다. 방 밖 · 해제된 사람은 404.
 * 규칙의 단위 시험: lib/omnis-session-share-rules.test.ts
 *
 * 세션은 DB 에 직접 만든다(질문 · 답 두 글). 이어 묻기는 시험 모델(OMNIS_AGENT_FAKE=1)이 답한다.
 * 시험 DB 를 직접 읽고 쓰므로 로컬 DB(CI · e2e-local)에서만 돈다. SHARE_SHOTS 에 절대 경로를 주면 화면을 남긴다.
 */
import { expect, test, type Browser, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { login, type DemoUser } from "./_setup"

const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")
test.skip(!LOCAL_DB, "시험 DB 를 직접 읽고 쓴다")

const prisma = LOCAL_DB ? new PrismaClient() : (null as unknown as PrismaClient)
const shots = process.env.SHARE_SHOTS
const stamp = Date.now()
const QUESTION = `분기 마감 업무 정리해 줘 ${stamp}`
const ANSWER = `마감 업무는 세 건입니다 ${stamp}`
const ROOM_NAME = `공유 받을 방 ${stamp}`
const FOLLOW = `담당별로 묶어 줘 ${stamp}`

const OWNER: DemoUser = "팀장"
const PERSON: DemoUser = "사원1"
const ROOM_MEMBER: DemoUser = "사원2"
const HEIR: DemoUser = "사원3"
const OUTSIDER: DemoUser = "부팀장"

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

async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` })
}

const sessionLog = (page: Page) => page.getByRole("log", { name: "옴니스와의 대화" }).filter({ visible: true })

test.describe("옴니스 세션 공유 · 해제 · 인계 @chat", () => {
  test.describe.configure({ mode: "serial" })
  let sessionId = ""
  let groupId = ""
  const ids = new Map<DemoUser, string>()

  test.beforeAll(async () => {
    const users = await prisma.user.findMany({ where: { name: { in: [OWNER, PERSON, ROOM_MEMBER, HEIR, OUTSIDER] } }, select: { id: true, name: true } })
    for (const u of users) ids.set(u.name as DemoUser, u.id)
    const owner = ids.get(OWNER)!
    const session = await prisma.chatRoom.create({
      data: { name: QUESTION.slice(0, 30), kind: "OMNIS_DM", createdById: owner, lastMessageAt: new Date(), members: { create: { userId: owner, lastReadAt: new Date() } } },
    })
    sessionId = session.id
    const t = Date.now()
    await prisma.chatMessage.create({ data: { roomId: sessionId, authorId: owner, content: QUESTION, createdAt: new Date(t - 60_000) } })
    await prisma.user.upsert({ where: { id: "system" }, update: {}, create: { id: "system", name: "Omnis", passwordHash: "!", role: "MEMBER", isActive: false } })
    await prisma.chatMessage.create({ data: { roomId: sessionId, authorId: "system", content: ANSWER, createdAt: new Date(t - 50_000) } })
    const group = await prisma.chatRoom.create({
      data: { name: ROOM_NAME, kind: "GROUP", createdById: owner, lastMessageAt: new Date(), members: { create: [OWNER, ROOM_MEMBER].map((n) => ({ userId: ids.get(n)! })) } },
    })
    groupId = group.id
  })

  test.afterAll(async () => {
    await prisma?.$disconnect()
  })

  // 지키는 것: 주인은 머리줄 「공유」 로 사람을 골라 공유하고, 받은 사람은 알림을 받아 목록에서 알아보고 이어 물을 수 있다
  test("사람에게 공유 → 알림 · 목록 「공유됨 · 팀장님」 · 이어 묻기는 쓴 사람 몫", async ({ browser }) => {
    const owner = await as(browser, OWNER)
    await owner.page.goto(`/chat/${sessionId}`)
    await owner.page.locator("[data-session-share-open]").click()
    const dialog = owner.page.locator("[data-session-share-dialog]")
    await expect(dialog).toBeVisible()
    await expect(dialog.locator("[data-share-current]")).toContainText("아직 나만 보는 대화예요")
    await dialog.locator(`[data-share-pick="${ids.get(PERSON)}"]`).click()
    await expect(dialog.locator("[data-share-people-save]")).toHaveText("1명에게 공유")
    await shot(owner.page, "pc-share-people")
    await dialog.locator("[data-share-people-save]").click()
    await expect(dialog.locator(`[data-share-person="${ids.get(PERSON)}"]`)).toBeVisible()
    await owner.ctx.close()

    expect(await prisma.notification.count({ where: { userId: ids.get(PERSON), type: "chat_omnis_shared", entityId: sessionId } })).toBe(1)
    expect((await prisma.chatRoomMember.findUniqueOrThrow({ where: { roomId_userId: { roomId: sessionId, userId: ids.get(PERSON)! } } })).shareKind).toBe("PERSON")

    const person = await as(browser, PERSON, true)
    const list = (await (await person.page.request.get("/api/chat/rooms")).json()) as { omnis: { id: string; sharedFrom?: string }[] }
    expect(list.omnis.find((r) => r.id === sessionId)?.sharedFrom).toBe(`${OWNER}님`)
    await person.page.goto("/chat")
    // 목록은 제목 옆 사람들 아이콘 — 누가 공유했는지는 이름표(aria-label)에 있다(#195)
    await expect(person.page.locator(`[data-shared-from][aria-label="공유됨 · ${OWNER}님"]`).first()).toBeVisible({ timeout: 15_000 })
    await shot(person.page, "phone-list-shared")
    await person.page.goto(`/chat/${sessionId}`)
    await expect(person.page.getByText(`공유됨 · ${OWNER}님의 대화`).filter({ visible: true }).first()).toBeVisible()
    // 받은 사람에게는 공유 단추가 없다 — 공유 · 해제 · 인계는 주인만
    await expect(person.page.locator("[data-session-share-open]")).toHaveCount(0)
    await expect(sessionLog(person.page).locator("[data-peer-message]").filter({ hasText: QUESTION })).toContainText(OWNER)
    const box = person.page.locator("[data-composer-pill] textarea").first()
    await expect.poll(() => box.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps")))).toBe(true)
    await box.fill(FOLLOW)
    await person.page.getByRole("button", { name: "보내기", exact: true }).click()
    await expect(person.page.getByText(`「${FOLLOW}」 를 받았어요`).filter({ visible: true }).first()).toBeVisible({ timeout: 45_000 })
    await shot(person.page, "phone-session-shared")
    const run = await prisma.agentRun.findFirstOrThrow({ where: { roomId: sessionId }, orderBy: { createdAt: "desc" } })
    expect(run.userId).toBe(ids.get(PERSON))
    // 공유받은 사람도 공유 API 는 403
    expect((await person.page.request.post(`/api/agent/rooms/${sessionId}/share`, { data: { userIds: [ids.get(HEIR)] } })).status()).toBe(403)
    await person.ctx.close()
  })

  // 지키는 것: 방에 공유하면 그 방 사람 모두가 보고, 방에는 아이콘 붙은 안내 한 줄 「공유했어요 · 열기」 가 남는다
  test("방에 공유 → 방 안내 한 줄 · 열기로 세션 · 답 공유 창의 바로가기", async ({ browser }) => {
    const owner = await as(browser, OWNER)
    await owner.page.goto(`/chat/${sessionId}`)
    // 답 아래 공유 창 → 「이 대화를 공유하기」 → 세션 공유 창
    await owner.page.locator("[data-answer-share]").first().click()
    await owner.page.locator("[data-answer-share-session]").click()
    const dialog = owner.page.locator("[data-session-share-dialog]")
    await expect(dialog).toBeVisible()
    await dialog.locator("[data-share-tab=room]").click()
    await dialog.locator(`[data-share-room-pick="${groupId}"]`).click()
    await shot(owner.page, "pc-share-room")
    await dialog.locator("[data-share-room-save]").click()
    await expect(dialog.locator(`[data-share-room="${groupId}"]`)).toBeVisible()
    await owner.ctx.close()

    const member = await as(browser, ROOM_MEMBER, true)
    await member.page.goto(`/chat/${groupId}`)
    const pill = member.page.locator("[data-system-pill]").filter({ hasText: `${OWNER}님이 옴니스 대화를 공유했어요` })
    await expect(pill).toBeVisible({ timeout: 20_000 })
    // 저장된 🤖 표식은 화면에서 옴니스 아이콘으로(#195)
    await expect(pill).not.toContainText("🤖")
    await expect(pill.locator("[data-omnis-inline-icon]")).toHaveCount(1)
    await shot(member.page, "phone-room-notice")
    await pill.locator("[data-omnis-session-link]").click()
    await member.page.waitForURL((u) => u.pathname.endsWith(sessionId), { timeout: 15_000 })
    await expect(member.page.getByText(`공유됨 · ${ROOM_NAME}`).filter({ visible: true }).first()).toBeVisible()
    await member.ctx.close()
    expect((await prisma.chatRoomMember.findUniqueOrThrow({ where: { roomId_userId: { roomId: sessionId, userId: ids.get(ROOM_MEMBER)! } } })).shareKind).toBe("ROOM")
  })

  // 지키는 것: 방 밖 사람에게 세션은 어느 길로도 없다
  test("비참여자 404", async ({ browser }) => {
    const { ctx, page } = await as(browser, OUTSIDER)
    expect((await page.request.get(`/api/agent/rooms/${sessionId}`)).status()).toBe(404)
    expect((await page.request.get(`/api/agent/rooms/${sessionId}/share`)).status()).toBe(404)
    expect((await page.request.post(`/api/agent/rooms/${sessionId}/share`, { data: { userIds: [ids.get(OUTSIDER)] } })).status()).toBe(404)
    expect((await page.request.post(`/api/agent/rooms/${sessionId}/handover`, { data: { userId: ids.get(OUTSIDER) } })).status()).toBe(404)
    expect(await (await page.request.get("/api/chat/rooms")).text()).not.toContain(sessionId)
    await page.goto(`/chat/${sessionId}`)
    await expect(page.getByText(ANSWER)).toHaveCount(0)
    await ctx.close()
  })

  // 지키는 것: 주인이 공유를 풀면 받은 사람은 그 순간부터 못 본다
  test("공유 해제 — 사람 · 방, 해제된 사람은 404", async ({ browser }) => {
    const owner = await as(browser, OWNER)
    await owner.page.goto(`/chat/${sessionId}`)
    await owner.page.locator("[data-session-share-open]").click()
    const dialog = owner.page.locator("[data-session-share-dialog]")
    await dialog.getByRole("button", { name: `${PERSON}님 공유 해제` }).click()
    await expect(dialog.locator(`[data-share-person="${ids.get(PERSON)}"]`)).toHaveCount(0)
    await dialog.locator(`[data-share-room="${groupId}"]`).getByRole("button", { name: "해제" }).click()
    await expect(dialog.locator(`[data-share-room="${groupId}"]`)).toHaveCount(0)
    await expect(dialog.locator("[data-share-current]")).toContainText("아직 나만 보는 대화예요")
    await owner.ctx.close()

    for (const who of [PERSON, ROOM_MEMBER] as const) {
      const { ctx, page } = await as(browser, who)
      expect((await page.request.get(`/api/agent/rooms/${sessionId}`)).status(), who).toBe(404)
      expect(await (await page.request.get("/api/chat/rooms")).text(), who).not.toContain(sessionId)
      await ctx.close()
    }
  })

  // 지키는 것: 주인을 넘기면(확인 한 번) 받은 사람이 주인이 되고, 이전 주인은 공유받은 사람으로 남는다
  test("인계 — 확인 한 번 · 새 주인에게 공유 단추 · 이전 주인은 참여자로", async ({ browser }) => {
    const owner = await as(browser, OWNER)
    await owner.page.goto(`/chat/${sessionId}`)
    await owner.page.locator("[data-session-share-open]").click()
    const dialog = owner.page.locator("[data-session-share-dialog]")
    await dialog.locator("[data-share-tab=handover]").click()
    await dialog.locator(`[data-handover-pick="${ids.get(HEIR)}"]`).click()
    await dialog.getByRole("button", { name: "넘기기…" }).click()
    await expect(dialog.locator("[data-handover-confirm]")).toContainText(`${HEIR}님에게 넘길까요?`)
    await shot(owner.page, "pc-handover-confirm")
    await dialog.locator("[data-handover-save]").click()
    await expect(dialog).toHaveCount(0)
    await expect(owner.page.locator("[data-session-share-open]")).toHaveCount(0)
    await expect(owner.page.getByText(`공유됨 · ${HEIR}님의 대화`).filter({ visible: true }).first()).toBeVisible()
    expect((await owner.page.request.post(`/api/agent/rooms/${sessionId}/share`, { data: { userIds: [ids.get(PERSON)] } })).status()).toBe(403)
    await owner.ctx.close()

    const room = await prisma.chatRoom.findUniqueOrThrow({ where: { id: sessionId }, select: { createdById: true } })
    expect(room.createdById).toBe(ids.get(HEIR))
    expect((await prisma.chatRoomMember.findUniqueOrThrow({ where: { roomId_userId: { roomId: sessionId, userId: ids.get(OWNER)! } } })).shareKind).toBe("PERSON")
    expect(await prisma.notification.count({ where: { userId: ids.get(HEIR), type: "chat_omnis_shared", entityId: sessionId } })).toBe(1)

    const heir = await as(browser, HEIR, true)
    await heir.page.goto(`/chat/${sessionId}`)
    await expect(heir.page.locator("[data-session-share-open]")).toBeVisible()
    await heir.page.locator("[data-session-share-open]").tap()
    await expect(heir.page.locator("[data-share-current]")).toContainText(HEIR)
    await shot(heir.page, "phone-heir-share")
    await heir.ctx.close()
  })
})
