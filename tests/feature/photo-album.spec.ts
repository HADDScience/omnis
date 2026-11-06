/**
 * 옴니스 답의 사진 묶음 — 답이 번호를 단 사진만 격자로 보이고, 눌러서 넘겨 본다.
 * 사진 실물은 쓰지 않는다: 데모는 파일 저장이 막혀 있어 /raw 를 작은 PNG 로 대신 받는다.
 *
 *   node scripts/e2e-local.mjs tests/feature/photo-album.spec.ts
 */
import "dotenv/config"
import { randomUUID } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"
import { prisma } from "../../lib/db"
import { getSystemUserId } from "../../lib/system-user"
import { quickLogin } from "./_setup"

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==",
  "base64"
)

const photo = (n: number) => ({
  id: randomUUID(),
  source: "PHOTO",
  sourceId: randomUUID(),
  title: `시험 사진 ${n}`,
  sourceLabel: "사진",
  similarity: 0.9,
})

test.describe("옴니스 답의 사진 묶음", () => {
  let roomId: string
  let queryId: string

  test.beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL!)
    if (!["localhost", "127.0.0.1", "::1"].includes(target.hostname))
      throw new Error("사진 묶음 E2E는 로컬 DB만 사용합니다.")
    const owner = await prisma.user.findFirstOrThrow({
      where: { name: "팀장" },
    })
    const systemId = await getSystemUserId()
    // 11번은 검색됐지만 답이 버린 사진 — 묶음에 뜨면 안 된다
    const sources = Array.from({ length: 11 }, (_, i) => photo(i + 1))
    const answer = "행사 부스 사진입니다 [1, 2-10]."
    const room = await prisma.chatRoom.create({
      data: {
        name: "사진 묶음 시험",
        kind: "OMNIS_DM",
        createdById: owner.id,
        members: { create: { userId: owner.id } },
      },
    })
    roomId = room.id
    const query = await prisma.omnisQuery.create({
      data: { userId: owner.id, question: "부스 사진 찾아줘", answer, sources },
    })
    queryId = query.id
    await prisma.chatMessage.create({
      data: {
        roomId,
        authorId: systemId,
        content: answer,
        omnisQueryId: queryId,
      },
    })
  })

  test.afterAll(async () => {
    await prisma.chatMessage.deleteMany({ where: { roomId } })
    await prisma.chatRoomMember.deleteMany({ where: { roomId } })
    await prisma.chatRoom.delete({ where: { id: roomId } })
    await prisma.omnisQuery.delete({ where: { id: queryId } })
    await prisma.$disconnect()
  })

  async function openRoom(page: Page) {
    await page.route(/\/api\/files\/[^/]+\/(raw|thumb)/, (route) =>
      route.fulfill({ contentType: "image/png", body: PNG })
    )
    await quickLogin(page, "팀장")
    await page.goto(`/chat/${roomId}`)
    const album = page.getByLabel("사진 10장", { exact: true })
    await album.waitFor({ timeout: 30_000 })
    return album
  }

  test("답이 번호를 단 사진만 묶고, 넘치면 +N 으로 접는다", async ({
    page,
  }) => {
    const album = await openRoom(page)
    await expect(album.getByRole("button")).toHaveCount(9)
    await expect(album.getByText("+1", { exact: true })).toBeVisible()
    await expect(
      page.getByRole("button", { name: "시험 사진 11 크게 보기" })
    ).toHaveCount(0)
  })

  test("눌러서 좌우로 넘기고 Escape 로 닫는다", async ({ page }) => {
    const album = await openRoom(page)
    await album
      .getByRole("button", { name: "시험 사진 1 크게 보기", exact: true })
      .click()
    const dialog = page.getByRole("dialog", { name: "사진 보기" })
    await expect(dialog).toContainText("10장 중 1번")
    await dialog.getByRole("button", { name: "다음 사진" }).click()
    await expect(dialog).toContainText("10장 중 2번")
    await page.keyboard.press("ArrowLeft")
    await expect(dialog).toContainText("10장 중 1번")
    // 처음에서 더 뒤로 가지 않는다(카톡처럼)
    await page.keyboard.press("ArrowLeft")
    await expect(dialog).toContainText("10장 중 1번")
    // 보이지 않던 10번째까지 뷰어로는 닿는다 — 썸네일 줄
    await dialog.getByRole("button", { name: "10번째 사진" }).click()
    await expect(dialog).toContainText("10장 중 10번")
    // 답의 사진은 글이 아니라 근거 — 지우기 · 공유 · 모아보기가 없다
    await expect(dialog.getByRole("button", { name: "삭제" })).toHaveCount(0)
    await expect(dialog.getByRole("button", { name: "공유" })).toHaveCount(0)
    await expect(dialog.getByRole("button", { name: "이 방 사진 모아보기" })).toHaveCount(0)
    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)
  })

  test.describe("터치 기기", () => {
    // .touch-target 은 터치(pointer: coarse)에서 44px 로 넓힌다
    test.use({ hasTouch: true })

    for (const width of [320, 200]) {
      test(`${width}px — 묶음이 잘리지 않고 뷰어 조작은 44px 이상이다`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 740 })
        const album = await openRoom(page)
        await album.scrollIntoViewIfNeeded()
        const cut = await album.evaluate(
          (el) => el.scrollWidth - el.clientWidth
        )
        expect(cut).toBeLessThanOrEqual(1)

        await album
          .getByRole("button", { name: "시험 사진 1 크게 보기", exact: true })
          .click()
        const dialog = page.getByRole("dialog", { name: "사진 보기" })
        await dialog.getByRole("button", { name: "닫기" }).waitFor()
        // 터치 화면은 밀어 넘긴다 — 이전 · 다음 단추를 그리지 않는다
        await expect(dialog.getByRole("button", { name: "다음 사진" })).toBeHidden()
        for (const control of [
          dialog.getByRole("button", { name: "닫기" }),
          dialog.getByRole("link", { name: "내려받기" }),
          dialog.getByRole("button", { name: "더보기" }),
          dialog.getByRole("button", { name: "1번째 사진" }),
        ]) {
          const size = await control.evaluate((el) => {
            const box = el.getBoundingClientRect()
            return { w: box.width, h: box.height }
          })
          expect(size.w).toBeGreaterThanOrEqual(44)
          expect(size.h).toBeGreaterThanOrEqual(44)
        }
      })
    }
  })
})
