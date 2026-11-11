/**
 * 폰 대화방 세부 — 말풍선 꼬리 · 가운데 알약 · 뒤로 캡슐의 안 읽은 수. 라이트 · 다크, PC 를 함께 본다.
 * 방을 시험 DB 에 직접 넣는다 — 로컬 DB(CI · e2e-local)에서만 돈다.
 */
import { randomUUID } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { login } from "./_setup"

const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")
test.skip(!LOCAL_DB, "시험 DB 를 직접 고친다")
test.describe.configure({ mode: "serial" })

const prisma = LOCAL_DB ? new PrismaClient() : (null as unknown as PrismaClient)
const roomId = randomUUID()
const DELETED_BODY = "지워서 내려오면 안 되는 본문"

test.beforeAll(async () => {
  const me = await prisma.user.findFirstOrThrow({ where: { name: "팀장" } })
  const a = await prisma.user.findFirstOrThrow({ where: { name: "사원1" } })
  await prisma.user.upsert({ where: { id: "system" }, update: {}, create: { id: "system", name: "Omnis", passwordHash: "!", role: "MEMBER", isActive: false } })
  await prisma.chatRoom.create({ data: { id: roomId, name: "세부 시험", kind: "GROUP", createdById: me.id, lastMessageAt: new Date(), members: { create: [{ userId: me.id }, { userId: a.id }] } } })
  const base = Date.now() - 3_600_000
  const lines: [string, string, number, Date?][] = [
    [a.id, "상대 첫 글", 0], [a.id, "상대 이어 쓴 글", 10_000],
    [me.id, "내 첫 글", 600_000], [me.id, "내 이어 쓴 글", 610_000],
    [a.id, DELETED_BODY, 1_200_000, new Date()],
    [a.id, "지운 글 뒤 첫 글", 1_210_000],
    ["system", "🤖 시스템 안내 글", 1_800_000],
  ]
  for (const [authorId, content, at, deletedAt] of lines) {
    await prisma.chatMessage.create({ data: { roomId, authorId, content, deletedAt, createdAt: new Date(base + at), changedAt: new Date(base + at) } })
  }
  const withFile = await prisma.chatMessage.create({ data: { roomId, authorId: a.id, content: "첨부 글", createdAt: new Date(base + 2_400_000), changedAt: new Date(base + 2_400_000) } })
  await prisma.file.create({ data: { name: "자료.pdf", path: `e2e/${roomId}.pdf`, size: 10, mimeType: "application/pdf", messageId: withFile.id } })
})
test.afterAll(async () => {
  await prisma?.$disconnect()
})

const ready = async (page: Page) => {
  await login(page, "팀장")
  await page.goto(`/chat/${roomId}`)
  await page.locator("section [data-message-id] [data-message-body]").first().waitFor({ timeout: 30_000 })
}
const body = (page: Page, text: string) => page.locator("section [data-message-body]", { hasText: text }).first()
const tail = (page: Page, text: string) =>
  // 폰은 글 칸이 말풍선이다(사진 · 파일은 그 아래 따로 놓인다)
  body(page, text).locator("[data-bubble]").evaluate((el) => {
    const t = getComputedStyle(el, "::before")
    const r = el.getBoundingClientRect()
    return { content: t.content, tailBg: t.backgroundColor, bg: getComputedStyle(el).backgroundColor, left: parseFloat(t.left), right: parseFloat(t.right), w: r.width }
  })

for (const theme of ["light", "dark"] as const) {
  test.describe(`폰 ${theme}`, () => {
    test.use({ viewport: { width: 402, height: 874 }, hasTouch: true, isMobile: true })
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("theme", t), theme)
    })

    test("꼬리는 묶음 첫 말풍선에만, 말풍선과 같은 색으로 바깥쪽에 난다", async ({ page }) => {
      await ready(page)
      await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(theme === "dark")
      const other = await tail(page, "상대 첫 글")
      expect(other.content).not.toBe("none")
      expect(other.tailBg).toBe(other.bg)
      expect(other.left).toBeLessThan(0)
      const mine = await tail(page, "내 첫 글")
      expect(mine.content).not.toBe("none")
      expect(mine.tailBg).toBe(mine.bg)
      expect(mine.right).toBeLessThan(0)
      // 내 글 색은 바탕에 비치지 않는다 — 꼬리가 겹친 자리가 진해지지 않는다
      expect(mine.bg).not.toMatch(/\/ 0\.|rgba/)
      expect((await tail(page, "상대 이어 쓴 글")).content).toBe("none")
      expect((await tail(page, "내 이어 쓴 글")).content).toBe("none")
      await expect(page.locator("section [data-tail]", { hasText: "첨부 글" })).toHaveCount(0)
    })

    test("지운 글과 시스템 글은 가운데 알약이고, 앞뒤 글을 묶지 않으며 본문이 없다", async ({ page }) => {
      await ready(page)
      const pills = page.locator("section [data-system-pill]")
      await expect(pills).toHaveCount(2)
      await expect(pills.first()).toHaveText("삭제된 메시지입니다")
      // 저장된 🤖 표식은 화면에서 옴니스 아이콘으로 — 글자로는 남지 않는다
      await expect(pills.last()).toHaveText("시스템 안내 글")
      await expect(pills.last().locator("[data-omnis-inline-icon]")).toBeVisible()
      await expect(page.getByText(DELETED_BODY)).toHaveCount(0)
      const g = await pills.first().evaluate((el) => {
        const r = el.firstElementChild!.getBoundingClientRect()
        const cs = getComputedStyle(el.firstElementChild!)
        return { center: Math.abs((r.left + r.right) / 2 - innerWidth / 2), h: r.height, radius: cs.borderTopLeftRadius, bg: cs.backgroundColor }
      })
      expect(g.center).toBeLessThanOrEqual(1)
      expect(g.h).toBe(26)
      expect(g.radius).toBe("13px")
      expect(g.bg).not.toBe("rgba(0, 0, 0, 0)")
      // 지운 글 뒤 글은 새 묶음이라 이름과 꼬리가 다시 나온다
      expect((await tail(page, "지운 글 뒤 첫 글")).content).not.toBe("none")
    })
  })
}

test.describe("폰 뒤로 캡슐", () => {
  test.use({ viewport: { width: 402, height: 874 }, hasTouch: true, isMobile: true })
  const BACK = 'section a[aria-label="채팅방 목록으로"]'
  const BADGE = `${BACK} [data-back-unread]`

  /** 목록 응답의 안 읽은 수를 정해 둔다 — 시드 · 다른 시험의 글에 흔들리지 않게 */
  const fixUnread = (page: Page, count: (key: string) => number) =>
    page.route("**/api/chat/rooms*", async (route) => {
      const res = await route.fetch()
      const data = await res.json()
      for (const part of ["omnis", "company", "tasks", "groups"]) {
        for (const r of data[part] ?? []) r.unread = count(r.key)
      }
      await route.fulfill({ response: res, json: data })
    })

  test("다른 방의 안 읽은 수를 합해 보이고 지금 보는 방은 뺀다", async ({ page }) => {
    await fixUnread(page, (key) => (key === `room:${roomId}` ? 7 : key === "room:default-room" ? 5 : 0))
    await ready(page)
    await expect(page.locator(BADGE)).toHaveText("5")
    const box = (await page.locator(BACK).boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(box.width).toBeGreaterThanOrEqual(44)
    await expect(page.locator(`${BACK} .sr-only`)).toHaveText("안 읽은 글 5개")
  })

  test("99 를 넘으면 99+ 이고 폭이 넘치지 않는다", async ({ page }) => {
    await fixUnread(page, (key) => (key === "room:default-room" ? 120 : 0))
    await ready(page)
    await expect(page.locator(BADGE)).toHaveText("99+")
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(402)
  })

  test("지금 보는 방에만 안 읽은 글이 있으면 뒤로 단추만 보인다", async ({ page }) => {
    await fixUnread(page, (key) => (key === `room:${roomId}` ? 7 : 0))
    await ready(page)
    await page.waitForTimeout(500)
    await expect(page.locator(BADGE)).toHaveCount(0)
    const box = (await page.locator(BACK).boundingBox())!
    expect([box.width, box.height]).toEqual([44, 44])
  })
})

test.describe("PC", () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test("꼬리가 없고 말풍선 색이 그대로이며, 지운 글은 가운데 알약이다", async ({ page }) => {
    await ready(page)
    const other = await tail(page, "상대 첫 글")
    expect(other.content).toBe("none")
    await expect(page.locator("section [data-system-pill]").first()).toHaveText("삭제된 메시지입니다")
    await expect(page.locator('section a[aria-label="채팅방 목록으로"]')).toBeHidden()
  })
})
