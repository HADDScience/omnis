/**
 * 출처 글이 이름만 댄 파일(#232) — 같은 이름의 첨부를 찾아 잇는다. 단, 보는 사람이 볼 수 있는 첨부만.
 * DB 쿼리(이름 같음 · 대소문자 · 방 권한)를 실제로 돈다 — 규칙 자체는 lib/source-facts.test.ts.
 * 시험 DB 에 직접 넣는다 — 로컬 DB(CI · e2e-local)에서만. 이름은 지어낸 것이다.
 */
import { randomUUID } from "node:crypto"
import { expect, test } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { quickLogin } from "./_setup"

const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")
test.skip(!LOCAL_DB, "시험 DB 를 직접 고친다")
test.describe.configure({ mode: "serial" })

const prisma = LOCAL_DB ? new PrismaClient() : (null as unknown as PrismaClient)
const stamp = randomUUID().slice(0, 8)
const PUBLIC_NAME = `시험계획서_${stamp}_최종.pdf`
const PRIVATE_NAME = `시험단톡자료_${stamp}.xlsx`
const ids = {
  group: `mention-group-${stamp}`,
  omnis: `mention-omnis-${stamp}`,
  mentionPublic: randomUUID(),
  mentionPrivate: randomUUID(),
  mentionPartial: randomUUID(),
  carrier: randomUUID(),
  groupCarrier: randomUUID(),
  publicFile: randomUUID(),
  privateFile: randomUUID(),
  query: "",
}

test.beforeAll(async () => {
  const owner = await prisma.user.findFirstOrThrow({ where: { name: "부팀장" } })
  const system = await prisma.user.upsert({
    where: { id: "system" },
    update: {},
    create: { id: "system", name: "Omnis", passwordHash: "!", role: "MEMBER", isActive: false, position: "시스템" },
  })
  const at = Date.now() - 2 * 86_400_000
  // 전사방 — 파일을 붙인 글, 이름만 댄 글(대소문자를 바꿔 적는다), 이름 일부만 댄 글
  await prisma.chatMessage.create({ data: { id: ids.carrier, roomId: "default-room", authorId: owner.id, content: "올립니다", createdAt: new Date(at) } })
  await prisma.file.create({ data: { id: ids.publicFile, name: PUBLIC_NAME, path: `/api/files/${ids.publicFile}/raw`, size: 1200, mimeType: "application/pdf", messageId: ids.carrier } })
  await prisma.chatMessage.create({ data: { id: ids.mentionPublic, roomId: "default-room", authorId: owner.id, content: `최종본은 ${PUBLIC_NAME.toUpperCase()} 로 보면 됩니다`, createdAt: new Date(at + 60_000) } })
  await prisma.chatMessage.create({ data: { id: ids.mentionPartial, roomId: "default-room", authorId: owner.id, content: `시험계획서_${stamp}.pdf 는 옛 판입니다`, createdAt: new Date(at + 90_000) } })
  // 부팀장만 든 단톡방의 첨부 — 전사방 글이 그 이름을 대도 방 밖 사람에게는 잇지 않는다
  await prisma.chatRoom.create({ data: { id: ids.group, name: `자료 단톡 ${stamp}`, kind: "GROUP", createdById: owner.id, lastMessageAt: new Date(at), members: { create: [{ userId: owner.id }] } } })
  await prisma.chatMessage.create({ data: { id: ids.groupCarrier, roomId: ids.group, authorId: owner.id, content: "", createdAt: new Date(at) } })
  await prisma.file.create({ data: { id: ids.privateFile, name: PRIVATE_NAME, path: `/api/files/${ids.privateFile}/raw`, size: 900, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", messageId: ids.groupCarrier, privateToUserId: owner.id } })
  await prisma.chatMessage.create({ data: { id: ids.mentionPrivate, roomId: "default-room", authorId: owner.id, content: `표는 ${PRIVATE_NAME} 참고`, createdAt: new Date(at + 120_000) } })
  // 옴니스 답 — 출처가 이름만 댄 글
  await prisma.chatRoom.create({ data: { id: ids.omnis, name: `시험 — 이름만 ${stamp}`, kind: "OMNIS_DM", createdById: owner.id, lastMessageAt: new Date(), members: { create: { userId: owner.id } } } })
  const answer = `계획서 최종본을 찾았습니다 [1].`
  const q = await prisma.omnisQuery.create({
    data: {
      userId: owner.id, question: "계획서 최종본", answer,
      sources: [{ id: randomUUID(), source: "CHAT_MESSAGE", sourceId: ids.mentionPublic, title: "부팀장의 메시지", sourceLabel: "채팅", similarity: 80 }],
    },
  })
  ids.query = q.id
  await prisma.chatMessage.create({ data: { roomId: ids.omnis, authorId: system.id, content: answer, omnisQueryId: q.id } })
})

test.afterAll(async () => {
  if (!prisma) return
  await prisma.file.deleteMany({ where: { id: { in: [ids.publicFile, ids.privateFile] } } })
  await prisma.chatMessage.deleteMany({ where: { id: { in: [ids.carrier, ids.mentionPublic, ids.mentionPartial, ids.mentionPrivate, ids.groupCarrier] } } })
  for (const roomId of [ids.omnis, ids.group]) {
    await prisma.chatMessage.deleteMany({ where: { roomId } })
    await prisma.chatRoom.deleteMany({ where: { id: roomId } })
  }
  if (ids.query) await prisma.omnisQuery.deleteMany({ where: { id: ids.query } })
  await prisma.$disconnect()
})

type Fact = { id: string; mentioned: { id: string; href: string | null }[] }
const factsFor = async (page: import("@playwright/test").Page) => {
  const res = await page.request.get(`/api/omnis/source-messages?ids=${ids.mentionPublic},${ids.mentionPrivate},${ids.mentionPartial}`)
  expect(res.ok()).toBe(true)
  const { facts } = (await res.json()) as { facts: Fact[] }
  return new Map(facts.map((f) => [f.id, f.mentioned]))
}

test("이름만 댄 글 — 같은 이름의 첨부를 올린 글 바로가기와 함께 잇는다(대소문자 무시)", async ({ page }) => {
  await quickLogin(page, "부팀장")
  const m = await factsFor(page)
  expect(m.get(ids.mentionPublic)?.map((f) => f.id)).toEqual([ids.publicFile])
  expect(m.get(ids.mentionPublic)?.[0].href).toContain(`#m-${ids.carrier}`)
  // 그 방 사람에게는 단톡방 첨부도 잇는다
  expect(m.get(ids.mentionPrivate)?.map((f) => f.id)).toEqual([ids.privateFile])
  // 이름 일부만 같으면 잇지 않는다
  expect(m.get(ids.mentionPartial)).toEqual([])
})

test("방 밖의 사람 — 단톡방 첨부는 이름이 같아도 잇지 않는다", async ({ page }) => {
  await quickLogin(page, "사원3")
  const m = await factsFor(page)
  expect(m.get(ids.mentionPublic)?.map((f) => f.id)).toEqual([ids.publicFile])
  expect(m.get(ids.mentionPrivate)).toEqual([])
})

test("답 아래 — 이름이 같은 파일 카드가 열기 · 내려받기로 뜬다", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("omnis:nudge-off:install", "1")
    localStorage.setItem("omnis:nudge-off:push", "1")
  })
  await quickLogin(page, "부팀장")
  await page.goto(`/chat/${ids.omnis}`)
  const answer = page.locator("[data-omnis-message][id^=\"m-\"]").last()
  await expect(answer).toContainText("계획서 최종본을 찾았습니다", { timeout: 20_000 })
  const card = answer.locator(`[data-source-file="${ids.publicFile}"][data-source-mentioned]`)
  await expect(card).toBeVisible()
  await expect(card).toContainText(PUBLIC_NAME)
  await expect(card.locator(`a[href*="/api/files/${ids.publicFile}/raw"]`).first()).toBeVisible()
})
