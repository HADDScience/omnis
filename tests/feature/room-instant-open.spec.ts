/**
 * 전사 · 1:1 · 단톡방 바로 열기(components/messenger/client-room.tsx, lib/room-snapshot.ts).
 * 시험 DB 를 직접 고치는 시험은 로컬 DB(CI · e2e-local)에서만 돈다.
 */
import { randomUUID } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { login, type DemoUser } from "./_setup"

const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")
test.skip(!LOCAL_DB, "시험 DB 를 직접 고친다")
test.describe.configure({ mode: "serial" })

const prisma = LOCAL_DB ? new PrismaClient() : (null as unknown as PrismaClient)
test.afterAll(async () => {
  await prisma?.$disconnect()
})

const LIST = 'aside[aria-label="채팅방 목록"]'
const row = (page: Page, roomId: string) => page.locator(`${LIST} a[href="/chat/${roomId}"]`)
const bubble = (page: Page, text: string) => page.locator("section [data-message-id]", { hasText: text })
const word = (tag: string) => `${tag} ${Date.now()}${Math.random().toString(36).slice(2, 7)}`
const userId = async (name: string) => (await prisma.user.findFirstOrThrow({ where: { name } })).id

async function openList(page: Page, roomId: string) {
  await page.goto("/chat")
  await row(page, roomId).waitFor({ timeout: 30_000 })
  await expect.poll(() => row(page, roomId).evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))), { timeout: 30_000 }).toBe(true)
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {})
}

async function storeKeys(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res) => {
      const r = indexedDB.open("omnis-chat-cache", 1)
      r.onsuccess = () => res(r.result)
    })
    return new Promise<string[]>((res) => {
      const q = db.transaction("kv").objectStore("kv").getAllKeys()
      q.onsuccess = () => res(q.result.map(String))
    })
  })
}

/** 팀장과 상대의 1:1 — 시험마다 새 방이라 앞 시험의 글이 섞이지 않는다 */
async function dm(name: DemoUser = "사원1") {
  const [me, peer] = await Promise.all([userId("팀장"), userId(name)])
  const roomId = randomUUID()
  await prisma.chatRoom.create({
    data: {
      id: roomId,
      name: word("시험 방"),
      kind: "GROUP",
      createdById: me,
      lastMessageAt: new Date(),
      members: { create: [{ userId: me }, { userId: peer }] },
    },
  })
  return { roomId, me, peer }
}

async function post(roomId: string, authorId: string, content: string, at = new Date()) {
  await prisma.chatRoom.update({ where: { id: roomId }, data: { lastMessageAt: at } })
  return (await prisma.chatMessage.create({ data: { roomId, authorId, content, createdAt: at, changedAt: at } })).id
}

/** 한 번 열어 저장본을 만든다. 저장은 첫 응답 뒤에 일어난다 */
async function prime(page: Page, roomId: string, seen: string) {
  await openList(page, roomId)
  await row(page, roomId).click()
  await bubble(page, seen).first().waitFor({ timeout: 30_000 })
  await expect.poll(async () => (await storeKeys(page)).some((k) => k.endsWith(`snap:room:${roomId}`)), { timeout: 10_000 }).toBe(true)
  await page.waitForTimeout(300)
}

for (const [device, use] of [
  ["PC", { viewport: { width: 1440, height: 900 } }],
  ["폰", { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }],
] as const) {
  test.describe(device, () => {
    test.use(use)

    test("서버 페이지를 부르지 않고, 저장본 뒤 새 글을 받아 붙인다", async ({ page }) => {
      const { roomId, peer } = await dm()
      const old = word("옛 글")
      await post(roomId, peer, old, new Date(Date.now() - 60_000))
      await login(page, "팀장")
      await prime(page, roomId, old)

      await openList(page, roomId)
      const rsc: string[] = []
      page.on("request", (r) => {
        if (r.headers()["rsc"] && r.url().includes(`/chat/${roomId}`)) rsc.push(r.url())
      })
      const fresh = word("새 글")
      await post(roomId, peer, fresh)
      await row(page, roomId).click()
      await bubble(page, old).first().waitFor({ timeout: 5_000 })
      await bubble(page, fresh).first().waitFor({ timeout: 10_000 })
      expect(rsc).toEqual([])
      expect(new URL(page.url()).pathname).toBe(`/chat/${roomId}`)
      await expect(page.locator("[data-room-syncing]")).toHaveCount(0)
      // 순서 — 옛 글 다음이 새 글
      const texts = await page.locator("section [data-message-id]").allInnerTexts()
      expect(texts.findIndex((t) => t.includes(old))).toBeLessThan(texts.findIndex((t) => t.includes(fresh)))
    })

    test("떠난 사이 지운 글 · 고친 글은 받아 바뀐다", async ({ page }) => {
      const { roomId, peer } = await dm()
      const gone = word("지울 글")
      const before = word("고칠 글")
      const goneId = await post(roomId, peer, gone, new Date(Date.now() - 60_000))
      const editId = await post(roomId, peer, before, new Date(Date.now() - 50_000))
      await login(page, "팀장")
      await prime(page, roomId, before)

      await openList(page, roomId)
      const after = word("고친 뒤")
      await prisma.chatMessage.update({ where: { id: goneId }, data: { deletedAt: new Date(), changedAt: new Date() } })
      await prisma.chatMessage.update({ where: { id: editId }, data: { content: after, editedAt: new Date(), changedAt: new Date() } })
      await row(page, roomId).click()
      await bubble(page, after).first().waitFor({ timeout: 10_000 })
      await expect(page.locator("section").first()).not.toContainText(gone)
      await expect(page.locator("section").first()).not.toContainText(before)
    })

    test("권한이 빠진 방 — 목록으로 돌아가고 저장본을 지운다", async ({ page }) => {
      const { roomId, me, peer } = await dm()
      const secret = word("빠질 방 글")
      await post(roomId, peer, secret)
      await login(page, "팀장")
      await prime(page, roomId, secret)

      await openList(page, roomId)
      await prisma.chatRoomMember.delete({ where: { roomId_userId: { roomId, userId: me } } })
      await row(page, roomId).click()
      await page.waitForURL("**/chat", { timeout: 15_000 })
      await expect.poll(async () => (await storeKeys(page)).some((k) => k.includes(roomId)), { timeout: 10_000 }).toBe(false)
      await expect(page.locator("body")).not.toContainText(secret, { timeout: 10_000 })
    })

    test("뒤로 · 앞으로 가기는 맞는 방을 보이고, 새로고침은 서버 페이지로 같은 방이다", async ({ page }) => {
      const a = await dm()
      const b = await dm()
      const textA = word("가 방 글")
      const textB = word("나 방 글")
      await post(a.roomId, a.peer, textA)
      await post(b.roomId, b.peer, textB)
      await login(page, "팀장")
      await openList(page, a.roomId)
      await row(page, a.roomId).click()
      await bubble(page, textA).first().waitFor({ timeout: 15_000 })
      if (device === "폰") {
        // 폰은 방이 화면 전체다 — 뒤로 가면 목록
        await page.goBack()
        await row(page, b.roomId).waitFor({ timeout: 10_000 })
        await expect(row(page, b.roomId)).toBeVisible()
      }
      await row(page, b.roomId).click()
      await bubble(page, textB).first().waitFor({ timeout: 15_000 })
      await page.goBack()
      if (device === "PC") {
        await bubble(page, textA).first().waitFor({ timeout: 15_000 })
        expect(new URL(page.url()).pathname).toBe(`/chat/${a.roomId}`)
        await page.goForward()
      } else {
        await row(page, b.roomId).waitFor({ timeout: 10_000 })
        await page.goForward()
      }
      await bubble(page, textB).first().waitFor({ timeout: 15_000 })
      expect(new URL(page.url()).pathname).toBe(`/chat/${b.roomId}`)
      await page.reload()
      await bubble(page, textB).first().waitFor({ timeout: 30_000 })
    })

    test("보낸 글은 한 번만 남고 저장본에 들어간다", async ({ page }) => {
      const { roomId, peer } = await dm()
      const seen = word("먼저 글")
      await post(roomId, peer, seen)
      await login(page, "팀장")
      await openList(page, roomId)
      await row(page, roomId).click()
      await bubble(page, seen).first().waitFor({ timeout: 15_000 })
      const text = word("보낸 글")
      const box = page.locator("section [data-composer-pill] textarea").first()
      await box.fill(text)
      await page.locator('section button[aria-label="보내기"]').first().click()
      await bubble(page, text).first().waitFor({ timeout: 10_000 })
      await page.waitForTimeout(3_500)
      await expect(bubble(page, text)).toHaveCount(1)
      expect(await prisma.chatMessage.count({ where: { content: text } })).toBe(1)
    })

    test("사진이 늦게 와도 맨 아래에 남는다", async ({ page }) => {
      const { roomId, peer } = await dm()
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAZAAAAEsCAIAAABi1XKVAAAAKklEQVR42u3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAAAAAAAAA8GQNfAABaFkYkgAAAABJRU5ErkJggg==",
        "base64",
      )
      await page.route("**/api/files/*/raw", async (route) => {
        await new Promise((r) => setTimeout(r, 400))
        await route.fulfill({ status: 200, contentType: "image/png", body: png })
      })
      for (let i = 0; i < 25; i++) await post(roomId, peer, `앞 글 ${i}`, new Date(Date.now() - (30 - i) * 1000))
      const text = word("사진 글")
      const id = await post(roomId, peer, text)
      const fileId = randomUUID()
      await prisma.file.create({ data: { id: fileId, name: "시험.png", path: `/api/files/${fileId}/raw`, size: 1000, mimeType: "image/png", messageId: id } })
      await login(page, "팀장")
      await openList(page, roomId)
      await row(page, roomId).click()
      const img = page.locator(`[data-message-id="${id}"] img`)
      await img.waitFor({ timeout: 15_000 })
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 10_000 }).toBeGreaterThan(0)
      await expect
        .poll(() => page.locator("section [data-keep-bottom]").first().evaluate((el) => Math.round(el.scrollHeight - el.clientHeight - el.scrollTop)), { timeout: 5_000 })
        .toBeLessThanOrEqual(1)
    })
  })
}

test("단톡방 참여자 수는 저장본에서 바로 보인다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const { roomId, peer } = await dm()
  const seen = word("단톡 글")
  await post(roomId, peer, seen)
  await login(page, "팀장")
  await prime(page, roomId, seen)
  const count = page.getByRole("button", { name: "참여자 2명" })
  await count.waitFor({ timeout: 10_000 })
  await page.waitForTimeout(300)
  // 참여자 응답을 늦춰도 수가 바로 보인다
  await page.route(`**/api/chat/people-rooms/${roomId}`, async (route) => {
    await new Promise((r) => setTimeout(r, 3_000))
    await route.continue()
  })
  await openList(page, roomId)
  await row(page, roomId).click()
  await count.waitFor({ timeout: 1_500 })
})

test("많이 쌓였으면 최신 한 페이지로 갈아 끼우고 앞 글을 이어 받는다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const { roomId, peer } = await dm()
  const old = word("옛 글")
  await post(roomId, peer, old, new Date(Date.now() - 3_600_000))
  await login(page, "팀장")
  await prime(page, roomId, old)
  await openList(page, roomId)
  const base = Date.now() - 250 * 100
  await prisma.chatMessage.createMany({ data: Array.from({ length: 250 }, (_, j) => ({ roomId, authorId: peer, content: `틈 ${j}`, createdAt: new Date(base + j * 100), changedAt: new Date(base + j * 100) })) })
  await row(page, roomId).click()
  await bubble(page, "틈 249").first().waitFor({ timeout: 10_000 })
  await expect(page.locator("section").first()).not.toContainText(old)
  const list = page.locator("section [data-keep-bottom]").first()
  await list.evaluate((el) => {
    el.scrollTop = 0
  })
  await bubble(page, "틈 219").first().waitFor({ timeout: 10_000 })
})

test("예전 저장분(room:)은 페이지를 열 때 지운다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const { roomId, me, peer } = await dm()
  await post(roomId, peer, word("글"))
  await login(page, "팀장")
  await openList(page, roomId)
  await page.evaluate(async (key) => {
    const db = await new Promise<IDBDatabase>((res) => {
      const r = indexedDB.open("omnis-chat-cache", 1)
      r.onsuccess = () => res(r.result)
    })
    await new Promise((res) => {
      const t = db.transaction("kv", "readwrite")
      t.objectStore("kv").put({ at: 1, value: [] }, key)
      t.oncomplete = res
    })
  }, `${me}:room:room:${roomId}`)
  expect((await storeKeys(page)).some((k) => k.includes(":room:room:"))).toBe(true)
  await page.reload()
  await row(page, roomId).waitFor({ timeout: 30_000 })
  await expect.poll(async () => (await storeKeys(page)).some((k) => k.includes(":room:room:")), { timeout: 10_000 }).toBe(false)
})

test("세션이 끝난 뒤 누르면 로그인으로 간다", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const { roomId, peer } = await dm()
  const seen = word("글")
  await post(roomId, peer, seen)
  await login(page, "팀장")
  await prime(page, roomId, seen)
  await openList(page, roomId)
  await context.clearCookies()
  await row(page, roomId).click()
  await page.waitForURL("**/login**", { timeout: 15_000 })
})

test("로그아웃 · 계정 변경 뒤 앞 사람 저장본이 없다", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const { roomId, me, peer } = await dm()
  const seen = word("글")
  await post(roomId, peer, seen)
  await login(page, "팀장")
  await prime(page, roomId, seen)
  expect((await storeKeys(page)).some((k) => k.startsWith(`${me}:snap:`))).toBe(true)

  // 계정 변경 — 로그아웃 없이 다른 사람으로 로그인
  await context.clearCookies()
  await login(page, "사원2")
  await page.waitForTimeout(1_000)
  expect((await storeKeys(page)).some((k) => k.startsWith(`${me}:`))).toBe(false)

  // 로그아웃 단추
  await page.goto("/settings")
  await page.getByRole("button", { name: /로그아웃/ }).first().click({ timeout: 30_000 })
  await page.waitForURL((u) => !u.pathname.startsWith("/settings"), { timeout: 20_000 })
  expect(await storeKeys(page)).toEqual([])
})

test("탭 → 첫 글 기록은 숫자뿐이다", async ({ page }) => {
  test.skip(process.env.NEXT_PUBLIC_UI_METRICS !== "1", "사용 기록이 꺼진 빌드")
  await page.setViewportSize({ width: 1440, height: 900 })
  const { roomId, me, peer } = await dm()
  const seen = word("비밀 내용")
  await post(roomId, peer, seen)
  await login(page, "팀장")
  await prime(page, roomId, seen)
  await openList(page, roomId)
  await prisma.uiEvent.deleteMany({ where: { userId: me, name: { startsWith: "room_first_message" } } })
  await row(page, roomId).click()
  await bubble(page, seen).first().waitFor({ timeout: 10_000 })
  await page.waitForTimeout(200)
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true })
    document.dispatchEvent(new Event("visibilitychange"))
  })
  await expect.poll(() => prisma.uiEvent.count({ where: { userId: me, name: "room_first_message_saved" } }), { timeout: 15_000 }).toBeGreaterThan(0)
  const rows = await prisma.uiEvent.findMany({ where: { userId: me, name: "room_first_message_saved" } })
  expect(rows[0].path).toBe("/chat/:id")
  expect(Number.isInteger(rows[0].value)).toBe(true)
  expect(JSON.stringify(rows)).not.toContain("비밀 내용")
  expect(JSON.stringify(rows)).not.toContain(roomId)
})
