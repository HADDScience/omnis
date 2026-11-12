/**
 * 채팅 사진 뷰어 — 카톡 뷰어처럼 넘기고, 닫고, 그 글로 가고, 모아보고, 지우고, 공유한다.
 * 사진 실물은 쓰지 않는다: /raw · /thumb 를 이 자리에서 만든 PNG 로 대신 받는다. 시험 글은 전사방에 만들고 지운다.
 */
import "dotenv/config"
import { randomUUID } from "node:crypto"
import sharp from "sharp"
import { expect, test, type Page } from "@playwright/test"
import { prisma } from "../../lib/db"
import { quickLogin } from "./_setup"

const COMPANY = "default-room"
const created = { messages: [] as string[], files: [] as string[] }
let me: string
let other: string
let png: Buffer

async function photoMessage(authorId: string, names: string[], at: Date) {
  const m = await prisma.chatMessage.create({ data: { roomId: COMPANY, authorId, content: "", createdAt: at } })
  created.messages.push(m.id)
  const ids: string[] = []
  for (const [i, name] of names.entries()) {
    const id = randomUUID()
    await prisma.file.create({ data: { id, name, path: `/api/files/${id}/raw`, size: 2000, mimeType: "image/png", messageId: m.id, createdAt: new Date(at.getTime() + i) } })
    created.files.push(id)
    ids.push(id)
  }
  return { messageId: m.id, fileIds: ids }
}

test.beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL!)
  if (!["localhost", "127.0.0.1", "::1"].includes(target.hostname)) throw new Error("사진 뷰어 E2E는 로컬 DB만 사용합니다.")
  me = (await prisma.user.findFirstOrThrow({ where: { name: "팀장" } })).id
  other = (await prisma.user.findFirstOrThrow({ where: { name: "사원1" } })).id
  png = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#7799cc" } }).png().toBuffer()
})

test.afterAll(async () => {
  await prisma.file.deleteMany({ where: { id: { in: created.files } } })
  await prisma.chatMessage.deleteMany({ where: { id: { in: created.messages } } })
  await prisma.$disconnect()
})

async function open(page: Page, query = "") {
  await page.route(/\/api\/files\/[^/]+\/(raw|thumb)/, (route) => route.fulfill({ status: 200, contentType: "image/png", body: png }))
  await quickLogin(page, "팀장")
  await page.goto(`/chat/${COMPANY}${query}`)
}

const viewer = (page: Page) => page.getByRole("dialog", { name: "사진 보기" })
const photoIn = (page: Page, messageId: string, n = 0) => page.locator(`[data-message-id="${messageId}"] [data-attachment-image]`).nth(n)

async function swipe(page: Page, dx: number, dy: number) {
  const box = (await viewer(page).locator("img[data-viewer-src]").boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + (dx * i) / 8, y + (dy * i) / 8)
  await page.mouse.up()
}

for (const [name, use] of [
  ["PC", { viewport: { width: 1440, height: 900 } }],
  ["폰", { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }],
] as const) {
  test.describe(name, () => {
    test.use(use)

    test("사진을 누르면 뷰어 — 이름 · 시각, 썸네일 줄, 넘기기, 주소, 원본으로 바뀜, 닫기", async ({ page }) => {
      const { messageId, fileIds } = await photoMessage(other, ["첫.png", "둘.png"], new Date(Date.now() - 1000))
      await open(page)
      await photoIn(page, messageId).click()
      const v = viewer(page)
      await expect(v).toBeVisible()
      await expect(v.getByRole("button", { name: /^사원1 \d{4}\. \d+\. \d+\. \d\d:\d\d 글로 이동$/ })).toBeVisible()
      await expect(v).toContainText("2장 중 1번")
      await expect(v.getByRole("button", { name: "1번째 사진" })).toHaveAttribute("aria-current", "true")
      await expect(page).toHaveURL(new RegExp(`[?&]photo=${fileIds[0]}`))
      await expect(v.locator("img[data-viewer-src]")).toHaveAttribute("data-viewer-src", "original")
      await expect(v.getByRole("link", { name: "내려받기" })).toHaveAttribute("href", `/api/files/${fileIds[0]}/raw`)
      await expect(v.getByRole("link", { name: "내려받기" })).toHaveAttribute("download", "첫.png")
      // 남의 글이라 지우기가 없다
      await expect(v.getByRole("button", { name: "삭제" })).toHaveCount(0)

      await swipe(page, -250, 0)
      await expect(v).toContainText("2장 중 2번")
      await expect(page).toHaveURL(new RegExp(`[?&]photo=${fileIds[1]}`))
      await v.getByRole("button", { name: "1번째 사진" }).click()
      await expect(v).toContainText("2장 중 1번")

      // 아래로 끌면 닫히고 주소에서도 빠진다
      await swipe(page, 0, 260)
      await expect(v).toHaveCount(0)
      await expect(page).not.toHaveURL(/photo=/)

      // Esc · 뒤로 가기로도 닫힌다
      await photoIn(page, messageId).click()
      await page.keyboard.press("Escape")
      await expect(v).toHaveCount(0)
      await photoIn(page, messageId).click()
      await expect(v).toBeVisible()
      await page.goBack()
      await expect(v).toHaveCount(0)
      await expect(page).toHaveURL(new RegExp(`/chat/${COMPANY}$`))
    })

    test("한 번 탭은 위아래 단추를 숨기고, 두 번 탭은 확대 · 되돌림", async ({ page }) => {
      const { messageId } = await photoMessage(other, ["탭.png"], new Date(Date.now() - 900))
      await open(page)
      await photoIn(page, messageId).click()
      const v = viewer(page)
      const back = v.getByRole("button", { name: "닫기" })
      const img = v.locator("img[data-viewer-src]")
      const box = (await img.boundingBox())!
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await expect.poll(() => back.evaluate((el) => getComputedStyle(el.parentElement!).opacity)).toBe("0")
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await expect.poll(() => back.evaluate((el) => getComputedStyle(el.parentElement!).opacity)).toBe("1")

      await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
      await expect.poll(() => img.evaluate((el) => (el as HTMLElement).style.transform)).toContain("scale(2.5)")
      await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
      await expect.poll(() => img.evaluate((el) => (el as HTMLElement).style.transform)).toContain("scale(1)")
    })

    test("새로고침 · 공유 링크(?photo=)로 다시 열리고, 이름을 누르면 그 글로 가서 튕긴다", async ({ page }) => {
      const { messageId, fileIds } = await photoMessage(other, ["주소.png"], new Date(Date.now() - 800))
      await page.addInitScript(() => {
        const plays: (string | null)[] = []
        ;(window as unknown as { __plays: (string | null)[] }).__plays = plays
        const original = Element.prototype.animate
        Element.prototype.animate = function (this: Element, ...args: Parameters<typeof original>) {
          const o = args[1]
          if (typeof o === "object" && o?.id === "chat-arrival") plays.push(this.getAttribute("data-message-id"))
          return original.apply(this, args)
        }
      })
      await open(page, `?photo=${fileIds[0]}`)
      const v = viewer(page)
      await expect(v).toBeVisible({ timeout: 15_000 })
      await v.getByRole("button", { name: /글로 이동$/ }).click()
      await expect(v).toHaveCount(0)
      await expect.poll(() => page.evaluate(() => (window as unknown as { __plays: string[] }).__plays)).toContain(messageId)
      await expect(page).not.toHaveURL(/photo=/)
    })

    // 2026-11-12 모아보기는 방 서랍의 사진 탭으로 옮겼다 — 뷰어를 닫고 서랍을 연다. 사진을 고르면 뷰어가 서랍 위에 뜬다
    test("모아보기 — 방 서랍의 사진 탭(최신순 격자)을 열고, 누르면 그 사진을 연다", async ({ page }) => {
      const older = await photoMessage(other, ["옛.png"], new Date(Date.now() - 700))
      const newer = await photoMessage(other, ["새.png"], new Date(Date.now() - 600))
      await open(page)
      await photoIn(page, older.messageId).click()
      await viewer(page).getByRole("button", { name: "이 방 사진 모아보기" }).click()
      await expect(viewer(page)).toHaveCount(0)
      const grid = page.getByRole("dialog", { name: /서랍$/ })
      await expect(grid.getByRole("tab", { name: "사진" })).toHaveAttribute("aria-selected", "true")
      const items = grid.getByRole("button", { name: /^사원1의 사진 / })
      await expect(items.first()).toHaveAccessibleName("사원1의 사진 새.png")
      await expect(items.nth(1)).toHaveAccessibleName("사원1의 사진 옛.png")
      await items.first().click()
      await expect(page).toHaveURL(new RegExp(`[?&]photo=${newer.fileIds[0]}`))
      await expect(viewer(page).locator("img[data-viewer-src]")).toHaveAttribute("alt", "새.png")
    })

    test("내 글의 사진은 확인 뒤 글째 지운다 · 공유는 앱 안 링크", async ({ page }) => {
      const mine = await photoMessage(me, ["내.png"], new Date(Date.now() - 500))
      await page.addInitScript(() => {
        const shared: string[] = []
        ;(window as unknown as { __shared: string[] }).__shared = shared
        Object.defineProperty(navigator, "share", { configurable: true, value: async (d: { url: string }) => void shared.push(d.url) })
      })
      await open(page)
      await photoIn(page, mine.messageId).click()
      const v = viewer(page)
      await v.getByRole("button", { name: "공유" }).click()
      await expect.poll(() => page.evaluate(() => (window as unknown as { __shared: string[] }).__shared)).toEqual([
        new URL(`/chat/${COMPANY}?photo=${mine.fileIds[0]}`, page.url()).toString(),
      ])

      await v.getByRole("button", { name: "더보기" }).click()
      await expect(v.getByRole("menuitem", { name: "원본 열기" })).toHaveAttribute("href", `/api/files/${mine.fileIds[0]}/raw`)
      await expect(v.getByRole("menuitem", { name: "글로 이동" })).toBeVisible()
      await page.keyboard.press("Escape")
      await expect(v.getByRole("menu")).toHaveCount(0)

      await v.getByRole("button", { name: "삭제" }).click()
      const confirm = v.getByRole("alertdialog", { name: "사진 지우기" })
      await confirm.getByRole("button", { name: "취소" }).click()
      expect((await prisma.chatMessage.findUniqueOrThrow({ where: { id: mine.messageId } })).deletedAt).toBeNull()
      await v.getByRole("button", { name: "삭제" }).click()
      await confirm.getByRole("button", { name: "지우기" }).click()
      await expect(v).toHaveCount(0)
      await expect.poll(async () => (await prisma.chatMessage.findUniqueOrThrow({ where: { id: mine.messageId } })).deletedAt).not.toBeNull()
      await expect(photoIn(page, mine.messageId)).toHaveCount(0)
    })

    test("공유 — Web Share 가 없으면 링크를 복사한다 · 화면 밖으로 넘치지 않고 단추는 44px", async ({ page }) => {
      const { messageId, fileIds } = await photoMessage(other, ["복사.png", "둘.png"], new Date(Date.now() - 400))
      await page.addInitScript(() => {
        const copied: string[] = []
        ;(window as unknown as { __copied: string[] }).__copied = copied
        Object.defineProperty(navigator, "share", { configurable: true, value: undefined })
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t: string) => void copied.push(t) } })
      })
      await open(page)
      await photoIn(page, messageId).click()
      const v = viewer(page)
      await v.getByRole("button", { name: "공유" }).click()
      await expect(v.getByRole("status")).toHaveText("링크를 복사했습니다")
      expect(await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied)).toEqual([new URL(`/chat/${COMPANY}?photo=${fileIds[0]}`, page.url()).toString()])

      expect(await v.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0)
      for (const label of ["닫기", "이 방 사진 모아보기", "더보기", "공유"]) {
        const b = (await v.getByRole("button", { name: label }).boundingBox())!
        expect(Math.min(b.width, b.height), label).toBeGreaterThanOrEqual(44)
      }
      const d = (await v.getByRole("link", { name: "내려받기" }).boundingBox())!
      expect(Math.min(d.width, d.height)).toBeGreaterThanOrEqual(44)
    })
  })
}
