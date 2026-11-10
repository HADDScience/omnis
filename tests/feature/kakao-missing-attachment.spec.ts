/**
 * 카톡에서 옮겼지만 첨부 실물이 없는 글 — 본문 자리표시(`Photo` · `3 photos` · `Video` · `File: 이름`) 대신 흐린 첨부 칸.
 * 판별 규칙의 단위 시험: lib/kakao-placeholder.test.ts. 여기서는 단톡방 · 업무 스레드 · 업무 상세에 그려지는지와
 * 눌러도 열리지 않는지, 이모티콘 · 통화 · 카톡 밖 글 · 첨부가 붙은 글은 그대로인지를 본다.
 * 시험 DB 에 글을 직접 넣는다 — 로컬 DB(CI · e2e-local)에서만 돈다. KAKAO_MISSING_SHOTS=<폴더> 면 화면을 찍는다.
 *
 *   node scripts/e2e-local.mjs tests/feature/kakao-missing-attachment.spec.ts
 */
import "dotenv/config"
import { randomUUID } from "node:crypto"
import path from "node:path"
import { expect, test, type Browser, type Page } from "@playwright/test"
import { prisma } from "../../lib/db"
import { quickLogin } from "./_setup"

const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")
const SHOTS = process.env.KAKAO_MISSING_SHOTS
const tag = randomUUID().slice(0, 8)
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==", "base64")
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }
const PC = { viewport: { width: 1440, height: 900 } }

async function quiet(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("omnis:nudge-off:install", "1")
    localStorage.setItem("omnis:nudge-off:push", "1")
  })
  await page.route(/\/api\/files\/[^/]+\/(raw|thumb)/, (route) => route.fulfill({ contentType: "image/png", body: PNG }))
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) })
}

test.describe("카톡 자리표시 글 — 흐린 첨부 칸", () => {
  test.skip(!LOCAL_DB, "시험 DB 에 글을 직접 넣는다")
  test.describe.configure({ mode: "serial" })

  let roomId: string
  let taskId: string
  const ids: string[] = []

  test.beforeAll(async () => {
    const lead = await prisma.user.findFirstOrThrow({ where: { name: "팀장" } })
    const member = await prisma.user.findFirstOrThrow({ where: { name: "사원1" } })
    const task = await prisma.task.findFirstOrThrow({ where: { status: { not: "DONE" } }, orderBy: { createdAt: "asc" } })
    taskId = task.id
    const room = await prisma.chatRoom.create({
      data: {
        name: `카톡 이식 시험 ${tag}`,
        kind: "GROUP",
        createdById: lead.id,
        members: { create: [{ userId: lead.id }, { userId: member.id }] },
      },
    })
    roomId = room.id
    const start = Date.now() - 60 * 60_000
    const lines: { content: string; by: string; kakao?: boolean; file?: boolean }[] = [
      { content: "지난주 행사 자료 올립니다", by: member.id, kakao: true },
      { content: "3 photos", by: member.id, kakao: true },
      { content: "Photo", by: lead.id, kakao: true },
      { content: "File: 행사 결과 보고서_초안.pdf", by: member.id, kakao: true },
      { content: "Video", by: member.id, kakao: true },
      { content: "Photo\nThe message has been deleted.", by: member.id, kakao: true },
      { content: "Emoticon", by: lead.id, kakao: true },
      { content: "Voice Call", by: member.id, kakao: true },
      { content: "Photo", by: lead.id, kakao: false },
      { content: "Photo", by: member.id, kakao: true, file: true },
      // 방의 마지막 글 — 목록 미리보기도 자리표시 대신 같은 이름
      { content: "2 photos", by: member.id, kakao: true },
    ]
    for (const [i, l] of lines.entries()) {
      const m = await prisma.chatMessage.create({
        data: {
          roomId,
          authorId: l.by,
          content: l.content,
          sourceId: l.kakao ? `kakao:e2e-${tag}-${i}` : null,
          createdAt: new Date(start + i * 60_000),
        },
      })
      ids.push(m.id)
      if (l.file) {
        await prisma.file.create({ data: { name: "20250901_140525_1.png", path: `/api/files/e2e-${tag}/raw`, size: 68, mimeType: "image/png", messageId: m.id } })
      }
    }
    // 업무 스레드는 전사방 글만 모은다 — 같은 꼴의 글을 전사방에 업무로 걸어 둔다
    const company = await prisma.chatRoom.findFirstOrThrow({ where: { kind: "COMPANY" } })
    for (const [i, content] of ["3 photos", "File: 행사 결과 보고서_초안.pdf"].entries()) {
      const m = await prisma.chatMessage.create({
        data: { roomId: company.id, authorId: member.id, content, sourceId: `kakao:e2e-${tag}-task-${i}`, taskId, createdAt: new Date(start + i * 60_000) },
      })
      ids.push(m.id)
    }
  })

  test.afterAll(async () => {
    await prisma?.file.deleteMany({ where: { messageId: { in: ids } } })
    await prisma?.chatMessage.deleteMany({ where: { id: { in: ids } } })
    if (roomId) {
      await prisma.chatRoomMember.deleteMany({ where: { roomId } })
      await prisma.chatRoom.delete({ where: { id: roomId } })
    }
    await prisma?.$disconnect()
  })

  async function open(browser: Browser, device: typeof PC | typeof PHONE) {
    const ctx = await browser.newContext(device)
    const page = await ctx.newPage()
    await quiet(page)
    await quickLogin(page, "팀장")
    await page.goto(`/chat/${roomId}`)
    await expect(page.locator(`[data-message-id="${ids[0]}"]`)).toBeVisible({ timeout: 15_000 })
    return { ctx, page }
  }

  const row = (page: Page, i: number) => page.locator(`[data-message-id="${ids[i]}"]`)

  for (const [label, device] of [["PC", PC], ["폰", PHONE]] as const) {
    test(`${label} 단톡방 — 자리표시 글만 흐린 칸, 눌러도 열리지 않는다`, async ({ browser }) => {
      const { ctx, page } = await open(browser, device)
      // 사진 3장 · 사진 · 파일 · 동영상 · 삭제 표시가 붙은 사진 · 사진 2장 — 여섯 칸
      await expect(page.locator("[data-missing-attachment]")).toHaveCount(6)
      await expect(row(page, 1).locator('[data-missing-attachment="photo"] [data-missing-label]')).toHaveText("사진 3장")
      await expect(row(page, 1)).toContainText("카톡 원본에만 있음")
      await expect(row(page, 1).locator("[data-bubble]")).not.toContainText("3 photos")
      await expect(row(page, 2).locator('[data-missing-attachment="photo"] [data-missing-label]')).toHaveText("사진")
      await expect(row(page, 3).locator('[data-missing-attachment="file"] [data-missing-label]')).toHaveText("행사 결과 보고서_초안.pdf")
      await expect(row(page, 3).locator("[data-bubble]")).not.toContainText("File:")
      await expect(row(page, 4).locator('[data-missing-attachment="video"] [data-missing-label]')).toHaveText("동영상")
      // 삭제 표시는 글로 남고 칸이 함께 그려진다
      await expect(row(page, 5).locator('[data-missing-attachment="photo"]')).toBeVisible()
      await expect(row(page, 5).locator("[data-bubble]")).toHaveText("The message has been deleted.")
      // 그대로 두는 글 — 이모티콘 · 통화 · 카톡 밖 글 · 첨부가 붙은 글
      await expect(row(page, 6).locator("[data-bubble]")).toHaveText("Emoticon")
      await expect(row(page, 7).locator("[data-bubble]")).toHaveText("Voice Call")
      await expect(row(page, 8).locator("[data-bubble]")).toHaveText("Photo")
      await expect(row(page, 8).locator("[data-missing-attachment]")).toHaveCount(0)
      await expect(row(page, 9).locator("[data-attachment-image]")).toBeVisible()
      await expect(row(page, 9).locator("[data-missing-attachment]")).toHaveCount(0)

      // 칸은 링크 · 단추가 아니다 — 눌러도 주소가 그대로고 사진 보기가 뜨지 않는다
      const tile = row(page, 1).locator("[data-missing-attachment]")
      expect(await tile.evaluate((el) => el.closest("a,button") === null && el.querySelector("a,button") === null)).toBe(true)
      const url = page.url()
      await tile.click()
      await page.waitForTimeout(300)
      expect(page.url()).toBe(url)
      await expect(page.getByRole("dialog")).toHaveCount(0)

      // 진짜 첨부와 같은 크기 — 사진은 4:3 칸, 폰은 화면 폭 70%
      const box = (await tile.boundingBox())!
      if (label === "폰") expect(Math.round(box.width)).toBe(Math.round(390 * 0.7))
      expect(Math.abs(box.height / box.width - 0.75)).toBeLessThan(0.02)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(device.viewport.width)

      // 방 목록의 마지막 글도 자리표시 대신 같은 이름
      if (label === "PC") await expect(page.getByText("사원1: 사진 2장").first()).toBeVisible()

      await row(page, 1).scrollIntoViewIfNeeded()
      await shot(page, `${label === "PC" ? "pc" : "phone"}-room`)
      // 아래쪽 — 파일 · 동영상 · 삭제 표시 · 그대로 두는 글
      await row(page, 7).scrollIntoViewIfNeeded()
      await shot(page, `${label === "PC" ? "pc" : "phone"}-room-2`)
      await ctx.close()
    })
  }

  test("업무 스레드 · 업무 상세의 대화 카드에도 흐린 칸", async ({ browser }) => {
    for (const [name, device] of [["pc", PC], ["phone", PHONE]] as const) {
      const ctx = await browser.newContext(device)
      const page = await ctx.newPage()
      await quiet(page)
      await quickLogin(page, "팀장")
      await page.goto(`/chat/task/${taskId}`)
      const tiles = page.locator("[data-missing-attachment]")
      await expect(tiles.filter({ hasText: "사진 3장" }).first()).toBeVisible({ timeout: 15_000 })
      await expect(tiles.filter({ hasText: "행사 결과 보고서_초안.pdf" }).first()).toBeVisible()
      await tiles.filter({ hasText: "사진 3장" }).first().scrollIntoViewIfNeeded()
      await shot(page, `${name}-task-thread`)
      if (name === "pc") {
        await page.goto(`/tasks/${taskId}`)
        const card = page.locator("[data-missing-attachment]").filter({ hasText: "사진 3장" }).first()
        await expect(card).toContainText("카톡 원본에만 있음")
        await card.scrollIntoViewIfNeeded()
        await shot(page, "pc-task-detail")
      }
      await ctx.close()
    }
  })
})
