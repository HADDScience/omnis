/**
 * 전사방 채팅 검색이 사진 설명에서도 찾는다. 글자 일치만 쓰고 임베딩은 부르지 않는다.
 * 사진 실물은 쓰지 않는다: 데모는 파일 저장이 막혀 있어 /raw 를 작은 PNG 로 대신 받는다.
 */
import "dotenv/config"
import { randomUUID } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"
import { prisma } from "../../lib/db"
import { quickLogin } from "./_setup"

const COMPANY = "default-room"
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==",
  "base64"
)
const uniq = () => `사진시험${randomUUID().slice(0, 8)}`
const describeText = (설명: string, 글자 = "없음", 검색어 = "없음") =>
  `종류: 시험분류값\n설명: ${설명}\n사진 속 글자: ${글자}\n용도: 시험용도값\n검색어: ${검색어}`

type Result = { id: string; snippet: string; photo?: { fileId: string; snippet: string } }
type SearchPage = { results: Result[]; total: number | null; hasMore: boolean; nextBefore: string | null }

const created = { messages: [] as string[], files: [] as string[], rooms: [] as string[] }
let ownerId: string

async function message(content: string, roomId = COMPANY, extra: { deletedAt?: Date; createdAt?: Date } = {}) {
  const m = await prisma.chatMessage.create({ data: { roomId, authorId: ownerId, content, ...extra } })
  created.messages.push(m.id)
  return m.id
}

async function photo(messageId: string, description: string, extra: { privateToUserId?: string; mimeType?: string } = {}) {
  const f = await prisma.file.create({
    data: { name: "시험.png", path: `e2e/${randomUUID()}.png`, size: 10, mimeType: extra.mimeType ?? "image/png", messageId, description, privateToUserId: extra.privateToUserId },
  })
  created.files.push(f.id)
  return f.id
}

async function search(page: Page, query: Record<string, string>): Promise<SearchPage> {
  const res = await page.request.get(`/api/chat/search?${new URLSearchParams({ roomId: COMPANY, ...query })}`)
  expect(res.ok()).toBe(true)
  return res.json()
}

test.beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL!)
  if (!["localhost", "127.0.0.1", "::1"].includes(target.hostname)) throw new Error("사진 검색 E2E는 로컬 DB만 사용합니다.")
  ownerId = (await prisma.user.findFirstOrThrow({ where: { name: "팀장" } })).id
})

test.afterAll(async () => {
  await prisma.file.deleteMany({ where: { id: { in: created.files } } })
  await prisma.chatMessage.deleteMany({ where: { id: { in: created.messages } } })
  await prisma.chatRoomMember.deleteMany({ where: { roomId: { in: created.rooms } } })
  await prisma.chatRoom.deleteMany({ where: { id: { in: created.rooms } } })
  await prisma.$disconnect()
})

test.describe("API", () => {
  test.beforeEach(async ({ page }) => {
    await quickLogin(page, "팀장")
  })

  test("설명 · 사진 속 글자 · 검색어에서 찾고, 라벨 · 종류 · 용도에는 걸리지 않는다", async ({ page }) => {
    const [a, b, c] = [uniq(), uniq(), uniq()]
    const id = await message("Photo")
    const fileId = await photo(id, describeText(`${a} 앞 부스`, b, c))
    for (const q of [a, b, c]) {
      const { results, total } = await search(page, { q })
      expect(total).toBe(1)
      expect(results.map((r) => r.id)).toEqual([id])
      expect(results[0].photo?.fileId).toBe(fileId)
      expect(results[0].photo?.snippet).toContain(q)
    }
    const labelsOnly = uniq()
    const other = await message("Photo")
    await photo(other, `종류: ${labelsOnly}\n설명: 다른 글자\n용도: ${labelsOnly}`)
    expect((await search(page, { q: labelsOnly })).total).toBe(0)
  })

  test("글과 사진 둘 다 걸려도 한 번, 시간 순서와 페이지를 지킨다", async ({ page }) => {
    const w = uniq()
    const base = Date.now() - 60_000
    const both = await message(`${w} 본문도 걸림`, COMPANY, { createdAt: new Date(base) })
    await photo(both, describeText(`${w} 첫째`))
    await photo(both, describeText(`${w} 둘째`))
    const ids: string[] = []
    for (let i = 1; i <= 21; i++) {
      const id = await message(i % 2 ? `${w} 글 ${i}` : "Photo", COMPANY, { createdAt: new Date(base + i * 100) })
      if (i % 2 === 0) await photo(id, describeText(`${w} 사진 ${i}`))
      ids.unshift(id)
    }
    const first = await search(page, { q: w })
    expect(first.total).toBe(22)
    expect(first.results.map((r) => r.id)).toEqual(ids.slice(0, 20))
    expect(first.hasMore).toBe(true)
    const second = await search(page, { q: w, before: first.nextBefore! })
    expect(second.results.map((r) => r.id)).toEqual([...ids.slice(20), both])
    expect(second.hasMore).toBe(false)
  })

  test("다른 방 사진은 전사방에서 안 나오고, 그 방 검색도 사진을 찾지 않는다", async ({ page }) => {
    const w = uniq()
    const room = await prisma.chatRoom.create({ data: { name: "사진 검색 시험", kind: "GROUP", createdById: ownerId, members: { create: { userId: ownerId } } } })
    created.rooms.push(room.id)
    const id = await message("Photo", room.id)
    await photo(id, describeText(w))
    expect((await search(page, { q: w })).total).toBe(0)
    expect((await search(page, { roomId: room.id, q: w })).total).toBe(0)
  })

  test("업무 대화 안 검색은 사진을 찾지 않는다", async ({ page }) => {
    const w = uniq()
    const task = await prisma.task.findFirstOrThrow({ select: { id: true } })
    const m = await prisma.chatMessage.create({ data: { roomId: COMPANY, authorId: ownerId, content: "Photo", taskId: task.id } })
    created.messages.push(m.id)
    await photo(m.id, describeText(w))
    expect((await search(page, { q: w, taskId: task.id })).total).toBe(0)
    expect((await search(page, { q: w })).total).toBe(1)
  })

  test("지운 글 · 비공개 첨부 · 사진 아닌 파일은 나오지 않는다", async ({ page }) => {
    const [gone, secret, doc] = [uniq(), uniq(), uniq()]
    await photo(await message("Photo", COMPANY, { deletedAt: new Date() }), describeText(gone))
    await photo(await message("Photo"), describeText(secret), { privateToUserId: ownerId })
    await photo(await message("Photo"), describeText(doc), { mimeType: "application/pdf" })
    for (const q of [gone, secret, doc]) {
      const { results, total } = await search(page, { q })
      expect(total).toBe(0)
      expect(results).toEqual([])
    }
  })

  test("빈 검색어는 찾지 않고, % · _ · \\ 는 글자 그대로 찾는다", async ({ page }) => {
    await photo(await message("Photo"), describeText("빈 검색어 시험"))
    expect(await search(page, { q: "   " })).toEqual({ results: [], hasMore: false, total: 0 })
    const w = uniq()
    await photo(await message("Photo"), describeText(`${w} 100%_완료\\끝`))
    expect((await search(page, { q: `${w} 100%_완료\\끝` })).total).toBe(1)
    expect((await search(page, { q: `${w}%끝` })).total).toBe(0)
    expect((await search(page, { q: `${w} 1_0` })).total).toBe(0)
  })

  test("보낸 사람 거르기와 함께 쓴다", async ({ page }) => {
    const w = uniq()
    await photo(await message("Photo"), describeText(w))
    expect((await search(page, { q: w, authorId: ownerId })).total).toBe(1)
    const other = await prisma.user.findFirstOrThrow({ where: { name: "사원1" } })
    expect((await search(page, { q: w, authorId: other.id })).total).toBe(0)
  })
})

for (const [name, use] of [
  ["PC", { viewport: { width: 1440, height: 900 } }],
  ["폰", { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }],
] as const) {
  test.describe(name, () => {
    test.use(use)

    test("사진으로 찾은 결과는 작은 사진과 표시가 보이고, 누르면 그 글에서 튕긴다", async ({ page }) => {
      await page.addInitScript(() => {
        const plays: (string | null)[] = []
        ;(window as unknown as { __plays: (string | null)[] }).__plays = plays
        const original = Element.prototype.animate
        Element.prototype.animate = function (this: Element, ...args: Parameters<typeof original>) {
          const options = args[1]
          if (typeof options === "object" && options?.id === "chat-arrival") plays.push(this.getAttribute("data-message-id"))
          return original.apply(this, args)
        }
      })
      await page.route(/\/api\/files\/[^/]+\/(raw|thumb)/, (route) => route.fulfill({ contentType: "image/png", body: PNG }))
      await quickLogin(page, "팀장")
      const w = uniq()
      const id = await message("Photo")
      const fileId = await photo(id, describeText(`${w} 안내판`))
      await page.goto(`/chat/${COMPANY}`)
      const toggle = page.getByRole("button", { name: "채팅 검색" })
      await toggle.waitFor({ timeout: 30_000 })
      await expect.poll(() => toggle.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))), { timeout: 30_000 }).toBe(true)
      await toggle.click()
      await page.getByRole("searchbox", { name: "채팅 검색어" }).fill(w)

      const hit = page.getByRole("button", { name: "사진으로 찾은 글로 이동" })
      await expect(hit).toBeVisible()
      await expect(hit).toContainText("사진으로 찾음")
      await expect(hit).toContainText(w)
      await expect(hit.locator("img")).toHaveAttribute("src", new RegExp(`/api/files/${fileId}/thumb\\?w=120`))
      const plays = () => page.evaluate(() => (window as unknown as { __plays: (string | null)[] }).__plays)
      await expect.poll(plays).toEqual([id])
      await hit.click()
      await expect.poll(plays).toEqual([id, id])
      await expect(page.locator(`[data-message-id="${id}"]`)).toBeInViewport()

      // 폭을 넘치지 않는다
      const overflow = await page.getByRole("search", { name: "채팅 검색" }).evaluate((el) => el.scrollWidth - el.clientWidth)
      expect(overflow).toBeLessThanOrEqual(1)
    })
  })
}
