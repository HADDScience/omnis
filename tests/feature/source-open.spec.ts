/**
 * 옴니스 답의 출처 글 — 각주 [n] 은 원문 글(방 · 업무방)로 가서 그 글을 강조하고, 답 아래에 출처 글의 파일 카드(열기 · 내려받기)를,
 * 카톡에서 옮길 때 실물을 받지 못한 자리표시 글(「File: 이름」)은 「원본 파일이 옴니스에 없음」 카드를 보인다.
 * 단톡방 글의 첨부는 그 방 사람에게만 — 방 밖의 사람에게는 카드도 각주 바로가기도 없다.
 * 시험 DB 에 업무 · 단톡방 · 옴니스 답을 직접 넣는다 — 로컬 DB(CI · e2e-local)에서만. 2026-11-12 기능 요청(원문 열기 · 받기)
 */
import { randomUUID } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { quickLogin } from "./_setup"

const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")
test.skip(!LOCAL_DB, "시험 DB 를 직접 고친다")
test.describe.configure({ mode: "serial" })

const prisma = LOCAL_DB ? new PrismaClient() : (null as unknown as PrismaClient)
const stamp = randomUUID().slice(0, 8)
const ids = {
  owner: "",
  outsider: "",
  task: randomUUID(),
  group: `src-group-${stamp}`,
  omnis: `src-omnis-${stamp}`,
  omnisOutsider: `src-omnis-out-${stamp}`,
  placeholder: randomUUID(),
  withFile: randomUUID(),
  file: randomUUID(),
  query: "",
  queryOutsider: "",
}
const PDF = `우수사례발표_시험_${stamp}_WC_06.pdf`
const REAL = `우수사례발표_시험_${stamp}_WC_04.pdf`

function answerFor(): { answer: string; sources: object[] } {
  return {
    answer: [
      "우수사례 발표자료를 찾았습니다.",
      "",
      `- \`${PDF}\` — 원본 파일이 옴니스에 없습니다 [1].`,
      `- \`${REAL}\` 은 단톡방에 첨부돼 있습니다 [2].`,
    ].join("\n"),
    sources: [
      { id: randomUUID(), source: "CHAT_MESSAGE", sourceId: ids.placeholder, title: "부팀장의 메시지", sourceLabel: "채팅", similarity: 80 },
      { id: randomUUID(), source: "CHAT_MESSAGE", sourceId: ids.withFile, title: "부팀장의 메시지", sourceLabel: "채팅", similarity: 78 },
    ],
  }
}

test.beforeAll(async () => {
  const owner = await prisma.user.findFirstOrThrow({ where: { name: "부팀장" } })
  const outsider = await prisma.user.findFirstOrThrow({ where: { name: "사원3" } })
  ids.owner = owner.id
  ids.outsider = outsider.id
  const system = await prisma.user.upsert({
    where: { id: "system" },
    update: {},
    create: { id: "system", name: "Omnis", passwordHash: "!", role: "MEMBER", isActive: false, position: "시스템" },
  })
  await prisma.task.create({
    data: { id: ids.task, name: `발표자료 준비 ${stamp}`, slug: `src-${stamp}`, instructorId: owner.id, assignees: { create: { userId: owner.id } } },
  })
  // 업무 스레드의 카톡 자리표시 — 첨부 없음
  const at = Date.now() - 3 * 86_400_000
  for (let i = 0; i < 3; i++) {
    await prisma.chatMessage.create({ data: { roomId: "default-room", taskId: ids.task, authorId: owner.id, content: `앞선 이야기 ${i}`, createdAt: new Date(at - (3 - i) * 60_000) } })
  }
  await prisma.chatMessage.create({
    data: { id: ids.placeholder, roomId: "default-room", taskId: ids.task, authorId: owner.id, content: `File: ${PDF}`, sourceId: `kakao:${stamp}a`, createdAt: new Date(at) },
  })
  // 단톡방(부팀장만) 글의 실제 첨부
  await prisma.chatRoom.create({ data: { id: ids.group, name: `발표 단톡 ${stamp}`, kind: "GROUP", createdById: owner.id, lastMessageAt: new Date(at), members: { create: [{ userId: owner.id }] } } })
  await prisma.chatMessage.create({ data: { id: ids.withFile, roomId: ids.group, authorId: owner.id, content: "", sourceId: `kakao:${stamp}b`, createdAt: new Date(at + 60_000) } })
  await prisma.file.create({
    data: { id: ids.file, name: REAL, path: `/api/files/${ids.file}/raw`, size: 2_400_000, mimeType: "application/pdf", messageId: ids.withFile, privateToUserId: owner.id },
  })
  // 옴니스 1:1 — 답(부팀장) · 같은 답을 단톡방 밖의 사원3 에게도
  for (const [roomId, userId, key] of [[ids.omnis, owner.id, "query"], [ids.omnisOutsider, outsider.id, "queryOutsider"]] as const) {
    await prisma.chatRoom.create({ data: { id: roomId, name: `시험 — 출처 ${stamp}`, kind: "OMNIS_DM", createdById: userId, lastMessageAt: new Date(), members: { create: { userId } } } })
    await prisma.chatMessage.create({ data: { roomId, authorId: userId, content: "우수사례 발표 자료 찾아줘", createdAt: new Date(Date.now() - 60_000) } })
    const { answer, sources } = answerFor()
    const q = await prisma.omnisQuery.create({ data: { userId, question: "우수사례 발표 자료 찾아줘", answer, sources } })
    ids[key] = q.id
    await prisma.chatMessage.create({ data: { roomId, authorId: system.id, content: answer, omnisQueryId: q.id } })
  }
})

test.afterAll(async () => {
  if (!prisma) return
  await prisma.file.deleteMany({ where: { id: ids.file } })
  for (const roomId of [ids.omnis, ids.omnisOutsider, ids.group]) {
    await prisma.chatMessage.deleteMany({ where: { roomId } })
    await prisma.chatRoom.deleteMany({ where: { id: roomId } })
  }
  await prisma.omnisQuery.deleteMany({ where: { id: { in: [ids.query, ids.queryOutsider].filter(Boolean) } } })
  await prisma.chatMessage.deleteMany({ where: { taskId: ids.task } })
  await prisma.taskAssignee.deleteMany({ where: { taskId: ids.task } })
  await prisma.task.deleteMany({ where: { id: ids.task } })
  await prisma.$disconnect()
})

const SHOTS = process.env.SOURCE_SHOTS
async function shot(page: Page, name: string) {
  if (!SHOTS) return
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${SHOTS}/${name}.png` })
}

const answer = (page: Page) => page.locator("[data-omnis-message][id^=\"m-\"]").last()

async function openAnswer(page: Page, user: "부팀장" | "사원3", roomId: string) {
  await page.addInitScript(() => {
    localStorage.setItem("omnis:nudge-off:install", "1")
    localStorage.setItem("omnis:nudge-off:push", "1")
  })
  await quickLogin(page, user)
  await page.goto(`/chat/${roomId}`)
  await expect(answer(page)).toContainText("우수사례 발표자료를 찾았습니다", { timeout: 20_000 })
}

test("답 아래 — 자리표시 글은 「원본 파일이 옴니스에 없음」, 첨부 글은 열기 · 내려받기 카드", async ({ page }) => {
  await openAnswer(page, "부팀장", ids.omnis)
  const files = answer(page).locator("[data-source-files]")
  const missing = files.locator(`[data-source-missing="${ids.placeholder}"]`)
  await expect(missing).toContainText(PDF)
  await expect(missing).toContainText("원본 파일이 옴니스에 없습니다 — 카톡 원본이나 보낸 사람에게 요청하세요")
  // 없는 파일에는 열기 · 내려받기가 없다
  await expect(missing.getByRole("link", { name: /열기|내려받기/ })).toHaveCount(0)

  const card = files.locator(`[data-source-file="${ids.file}"]`)
  await expect(card).toContainText(REAL)
  await expect(card).toContainText("2.3MB")
  await expect(card).toContainText(`「발표 단톡 ${stamp}」`)
  await expect(card.getByRole("link", { name: `${REAL} 열기` })).toHaveAttribute("href", new RegExp(`/api/files/${ids.file}/raw$`))
  await expect(card.getByRole("link", { name: `${REAL} 열기` })).toHaveAttribute("target", "_blank")
  await expect(card.getByRole("link", { name: `${REAL} 내려받기` })).toHaveAttribute("download", REAL)
  await expect(card.getByRole("link", { name: /원문 글로/ })).toHaveAttribute("href", new RegExp(`/chat/${ids.group}#m-${ids.withFile}$`))
  await files.scrollIntoViewIfNeeded()
  await shot(page, "pc_답_파일카드")
})

test("폰 — 파일 카드가 화면 폭 안에 들어온다", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const page = await ctx.newPage()
  await openAnswer(page, "부팀장", ids.omnis)
  const files = answer(page).locator("[data-source-files]")
  await expect(files.locator(`[data-source-file="${ids.file}"]`)).toBeVisible()
  const box = (await files.boundingBox())!
  expect(box.x + box.width).toBeLessThanOrEqual(390)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await files.scrollIntoViewIfNeeded()
  await shot(page, "phone_답_파일카드")
  await ctx.close()
})

test("각주 [1] — 업무방의 그 글로 가서 가운데 두고 강조한다", async ({ page }) => {
  await openAnswer(page, "부팀장", ids.omnis)
  const cite = answer(page).locator("button.omnis-citation--link", { hasText: "1" }).first()
  await expect(cite).toBeVisible()
  await cite.hover()
  await expect(page.getByText(`업무 「발표자료 준비 ${stamp}」 · 부팀장 — 원문 글로`)).toBeVisible()
  await shot(page, "pc_각주_툴팁")
  await cite.click()
  await page.waitForURL(new RegExp(`/chat/task/${ids.task}#m-${ids.placeholder}$`), { timeout: 20_000 })
  const target = page.locator(`[data-message-id="${ids.placeholder}"]`)
  await expect(target).toHaveAttribute("data-arrived", "")
  await expect(target).toBeInViewport()
  await shot(page, "pc_각주_업무방_도착강조")
})

test("단톡방의 글 — 원문 글로 가면 그 방에서 그 글을 강조한다", async ({ page }) => {
  await openAnswer(page, "부팀장", ids.omnis)
  await answer(page).locator(`[data-source-file="${ids.file}"]`).getByRole("link", { name: /원문 글로/ }).click()
  await page.waitForURL(new RegExp(`/chat/${ids.group}#m-${ids.withFile}$`), { timeout: 20_000 })
  await expect(page.locator(`[data-message-id="${ids.withFile}"]`).first()).toBeInViewport({ timeout: 15_000 })
  await shot(page, "pc_단톡방_도착")
})

test("방 밖의 사람 — 단톡방 글의 카드 · 바로가기 · 원문 정보가 없다(있다는 것도 새지 않게)", async ({ page }) => {
  await openAnswer(page, "사원3", ids.omnisOutsider)
  const files = answer(page).locator("[data-source-files]")
  // 업무 스레드 글은 회사 전체가 보므로 자리표시 카드는 보인다
  await expect(files.locator(`[data-source-missing="${ids.placeholder}"]`)).toBeVisible()
  await expect(files.locator(`[data-source-file="${ids.file}"]`)).toHaveCount(0)
  await expect(answer(page)).not.toContainText(`발표 단톡 ${stamp}`)
  // [2] 는 바로가기가 아닌 배지로 남는다
  await expect(answer(page).locator("button.omnis-citation--link", { hasText: "2" })).toHaveCount(0)
  const res = await page.request.get(`/api/omnis/source-messages?ids=${ids.withFile},${ids.placeholder}`)
  const body = (await res.json()) as { facts: { id: string }[] }
  expect(body.facts.map((f) => f.id)).toEqual([ids.placeholder])
  expect((await page.request.get(`/api/files/${ids.file}`)).status()).toBe(404)
  await shot(page, "pc_방밖사람_답")
})
