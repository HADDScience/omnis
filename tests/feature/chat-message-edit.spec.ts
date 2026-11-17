/**
 * 채팅 글 고치기(2026-11-17) — 내 글을 고치면 「수정됨」 과 고친 시각이 붙고 원문이 이력에 남는다.
 * 남의 글 · 카톡에서 옮겨 온 글에는 「수정」 이 없다.
 *
 *   pnpm run test:e2e:local -- tests/feature/chat-message-edit.spec.ts --project=feature
 *
 * 전사방(default-room)에 글을 남기고 끝에 지운다. 이력 · 카톡 글 확인은 DB 를 직접 본다 — 격리된 시험 DB 에서만.
 */
import { expect, test, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { login } from "./_setup"

const ROOM = "default-room"
const isolated = process.env.E2E_ISOLATED === "true"

const row = (page: Page, text: string) =>
  page.locator('[role="log"][aria-label="채팅 메시지"] [data-message-id]', { hasText: text })
/** 고치는 중에는 본문이 textarea 값이라 글로 찾을 수 없다 — 글 ID 로 잡는다 */
const rowById = (page: Page, id: string) => page.locator(`[role="log"][aria-label="채팅 메시지"] [data-message-id="${id}"]`)

async function post(page: Page, content: string) {
  const res = await page.request.post("/api/chat/messages", { data: { roomId: ROOM, content } })
  expect(res.status()).toBe(201)
  return ((await res.json()) as { id: string }).id
}

test("내 글을 고치면 「수정됨」 이 붙고, 남의 글 · 카톡 글에는 「수정」 이 없다", async ({ page, browser }) => {
  const stamp = Date.now()
  const mineText = `고칠 글 ${stamp}`
  const editedText = `고친 글 ${stamp}`
  const otherText = `남의 글 ${stamp}`
  const kakaoText = `카톡 글 ${stamp}`
  const prisma = isolated ? new PrismaClient() : null
  const cleanup: (() => Promise<unknown>)[] = []

  // 남 — 창 없이 API 로만 쓴다
  const otherCtx = await browser.newContext()
  const other = await otherCtx.newPage()
  await login(other, "사원1")
  const otherId = await post(other, otherText)
  cleanup.push(() => other.request.delete(`/api/chat/messages/${otherId}`))

  try {
    await login(page, "팀장")
    const mineId = await post(page, mineText)
    cleanup.push(() => page.request.delete(`/api/chat/messages/${mineId}`))
    if (prisma) {
      const me = await prisma.user.findFirstOrThrow({ where: { name: "팀장" }, select: { id: true } })
      const k = await prisma.chatMessage.create({
        data: { roomId: ROOM, authorId: me.id, content: kakaoText, sourceId: `kakao:e2e-${stamp}` },
      })
      cleanup.push(() => prisma.chatMessage.delete({ where: { id: k.id } }))
    }

    await page.goto(`/chat/${ROOM}`)
    await expect(row(page, mineText)).toBeVisible({ timeout: 30_000 })

    // 내 글 — 올려 두면 메뉴가 뜨고 「수정」 이 있다
    const mineRow = rowById(page, mineId)
    await mineRow.hover()
    await mineRow.getByRole("button", { name: "수정" }).click()
    const box = mineRow.locator("textarea")
    await box.fill(editedText)
    // dev 서버는 라우트를 처음 부를 때 컴파일하느라 늦다 — 저장 응답을 기다린 뒤 본다
    const saved = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().endsWith(`/api/chat/messages/${mineId}`), { timeout: 60_000 })
    await box.press("Enter")
    expect((await saved).status()).toBe(200)

    // 고치는 칸이 닫히고 새 본문 옆에 「수정됨 + 시각」
    await expect(mineRow.locator("textarea")).toHaveCount(0)
    await expect(mineRow).toContainText(editedText)
    await expect(mineRow.locator("[data-edited]").first()).toHaveText(/^수정됨 오[전후] \d{1,2}:\d{2}$/)
    await expect(mineRow).not.toContainText(mineText)

    // 남의 글 — 답장은 있고 수정 · 삭제는 없다
    await expect(row(page, otherText)).toBeVisible()
    await row(page, otherText).hover()
    await expect(row(page, otherText).getByRole("button", { name: "답장" })).toBeVisible()
    await expect(row(page, otherText).getByRole("button", { name: "수정" })).toHaveCount(0)
    // 화면을 건너뛰어도 서버가 막는다
    const forced = await page.request.patch(`/api/chat/messages/${otherId}`, { data: { content: "남의 글 덮어쓰기" } })
    expect(forced.status()).toBe(403)

    if (prisma) {
      // 원문은 이력에 남는다(관리자 감사)
      const revs = await prisma.chatMessageRevision.findMany({ where: { messageId: mineId }, select: { content: true } })
      expect(revs.map((r) => r.content)).toEqual([mineText])

      // 카톡 글 — 내 글이어도 「수정」 이 없고, 서버도 막는다
      await expect(row(page, kakaoText)).toBeVisible()
      await row(page, kakaoText).hover()
      await expect(row(page, kakaoText).getByRole("button", { name: "삭제" })).toBeVisible()
      await expect(row(page, kakaoText).getByRole("button", { name: "수정" })).toHaveCount(0)
      const kakao = await prisma.chatMessage.findFirstOrThrow({ where: { content: kakaoText }, select: { id: true } })
      const refused = await page.request.patch(`/api/chat/messages/${kakao.id}`, { data: { content: "카톡 글 고치기" } })
      expect(refused.status()).toBe(403)
    }
  } finally {
    for (const fn of cleanup.reverse()) await fn().catch(() => {})
    await otherCtx.close()
    await prisma?.$disconnect()
  }
})
