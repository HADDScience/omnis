/**
 * 폰 전사 · 사람 방의 사진 · 파일 표시. 사진 응답은 route 로 주고(NAS 없음), 402px 값 · 찌그러짐 · 높이 상한 · 맨 아래 유지를 본다.
 * 방을 시험 DB 에 넣는다 — 로컬 DB 에서만 돈다.
 */
import { randomUUID } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"
import sharp from "sharp"
import { PrismaClient } from "../../generated/prisma/client"
import { login } from "./_setup"

const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")
test.skip(!LOCAL_DB, "시험 DB 를 직접 고친다")
test.describe.configure({ mode: "serial" })

const prisma = LOCAL_DB ? new PrismaClient() : (null as unknown as PrismaClient)
const roomId = randomUUID()
const sizes = new Map<string, [number, number]>()
const LONG_NAME = "아주 길게 지은 파일 이름이 카드 안에서 두 줄로 줄어드는지 보려고 일부러 늘려 쓴 회의 자료 최종본 수정본.pptx"

async function message(authorId: string, content: string, files: { name: string; mimeType: string; size?: [number, number] }[], minutesAgo: number, replyToId?: string) {
  const at = new Date(Date.now() - minutesAgo * 60_000)
  const id = randomUUID()
  await prisma.chatMessage.create({ data: { id, roomId, authorId, content, createdAt: at, changedAt: at, replyToId } })
  for (const f of files) {
    const fileId = randomUUID()
    if (f.size) sizes.set(fileId, f.size)
    await prisma.file.create({ data: { id: fileId, name: f.name, path: `/api/files/${fileId}/raw`, size: 180_000, mimeType: f.mimeType, messageId: id } })
  }
  return id
}

const ids: Record<string, string> = {}
test.beforeAll(async () => {
  const me = await prisma.user.findFirstOrThrow({ where: { name: "팀장" } })
  const a = await prisma.user.findFirstOrThrow({ where: { name: "사원1" } })
  await prisma.chatRoom.create({ data: { id: roomId, name: "첨부 시험", kind: "GROUP", createdById: me.id, lastMessageAt: new Date(), members: { create: [{ userId: me.id }, { userId: a.id }] } } })
  const png = (name: string, size: [number, number]) => ({ name, mimeType: "image/png", size })
  ids.wide = await message(a.id, "", [png("가로.png", [1600, 900])], 90)
  ids.tall = await message(a.id, "", [png("세로.png", [900, 1200])], 80)
  ids.long = await message(me.id, "", [png("긴세로.png", [600, 4000])], 70)
  ids.textPhoto = await message(a.id, "글과 사진", [png("정사각.png", [800, 800])], 60)
  ids.grid = await message(me.id, "", [png("하나.png", [800, 800]), png("둘.png", [800, 800]), png("셋.png", [800, 800])], 50)
  ids.pdf = await message(a.id, "", [{ name: "보고서.pdf", mimeType: "application/pdf" }], 40)
  ids.ppt = await message(me.id, "", [{ name: LONG_NAME, mimeType: "application/vnd.ms-powerpoint" }], 30)
  ids.missing = await message(a.id, "", [{ name: "없는사진.png", mimeType: "image/png" }], 20)
  ids.reply = await message(me.id, "답장 글", [], 10, ids.textPhoto)
})
test.afterAll(async () => {
  await prisma?.$disconnect()
})

async function serveImages(page: Page, delay = 0) {
  await page.route("**/api/files/*/raw", async (route) => {
    const id = route.request().url().split("/api/files/")[1].split("/")[0]
    const size = sizes.get(id)
    if (delay) await new Promise((r) => setTimeout(r, delay))
    if (!size) return route.fulfill({ status: 404, body: "" })
    const body = await sharp({ create: { width: size[0], height: size[1], channels: 3, background: "#7799cc" } }).png().toBuffer()
    await route.fulfill({ status: 200, contentType: "image/png", body })
  })
}

async function open(page: Page) {
  await serveImages(page)
  await login(page, "팀장")
  await page.goto(`/chat/${roomId}`)
  await page.locator(`[data-message-id="${ids.reply}"]`).waitFor({ timeout: 30_000 })
}

const imageBox = (page: Page, messageId: string) =>
  page.locator(`[data-message-id="${messageId}"] [data-attachment-image]`).first().evaluate(async (el) => {
    const img = el.querySelector("img") as HTMLImageElement
    img.loading = "eager"
    el.scrollIntoView({ block: "center" })
    // 사진은 미리보기(/thumb)를 거쳐 원본으로 온다 — 앞 시험이 서버를 데워 두면 4초 안에 못 올 때가 있다
    for (let i = 0; i < 200 && !img.naturalWidth; i++) await new Promise((r) => setTimeout(r, 100))
    await new Promise((r) => setTimeout(r, 100))
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    const shown = getComputedStyle(img)
    return { w: r.width, h: r.height, radius: cs.borderTopLeftRadius, fit: shown.objectFit, natural: img.naturalWidth / img.naturalHeight }
  })

test.describe("폰 402px", () => {
  test.use({ viewport: { width: 402, height: 874 }, hasTouch: true, isMobile: true })

  test("사진은 말풍선 없이 화면 70% 폭 · 모서리 13, 비율대로이고 높이 상한이 있다", async ({ page }) => {
    await open(page)
    const wide = await imageBox(page, ids.wide)
    expect(wide.w).toBeCloseTo(281.4, 0)
    expect(wide.radius).toBe("13px")
    expect(wide.h).toBeCloseTo(281.4 * (900 / 1600), 0)
    const tall = await imageBox(page, ids.tall)
    expect(tall.h).toBeCloseTo(281.4 * (1200 / 900), 0)
    const long = await imageBox(page, ids.long)
    expect(long.h).toBe(420)
    expect(long.w).toBeCloseTo(281.4, 0)
    expect(long.fit).toBe("cover")
    // 글 없는 첨부는 빈 말풍선이 없다 — 카톡 자리표시(Photo · File: 이름)를 뺀 이식 글이 이 꼴이다
    for (const id of [ids.wide, ids.grid, ids.pdf]) await expect(page.locator(`[data-message-id="${id}"] [data-message-body] > p`)).toBeHidden()
  })

  test("글과 사진이 한 메시지면 글 말풍선 아래 사진이 따로 놓이고 시각은 옆 아래다", async ({ page }) => {
    await open(page)
    const row = page.locator(`[data-message-id="${ids.textPhoto}"]`)
    await imageBox(page, ids.textPhoto)
    const g = await row.evaluate((el) => {
      const p = el.querySelector("[data-message-body] > p")!.getBoundingClientRect()
      const i = el.querySelector("[data-attachment-image]")!.getBoundingClientRect()
      const t = el.querySelector("[data-bubble-time] time")!.getBoundingClientRect()
      return { gap: i.top - p.bottom, left: i.left - p.left, timeLeft: t.left - i.right, timeBottom: i.bottom - t.bottom }
    })
    expect(g.gap).toBe(6)
    expect(g.left).toBe(0)
    expect(g.timeLeft).toBe(4)
    expect(g.timeBottom).toBeGreaterThanOrEqual(0)
    expect(g.timeBottom).toBeLessThan(2)
  })

  test("여러 장은 격자로 묶인다", async ({ page }) => {
    await open(page)
    const tiles = await page.locator(`[data-message-id="${ids.grid}"] [data-attachment-grid] [data-attachment-image]`).evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), Math.round(r.top)] }))
    expect(tiles).toHaveLength(3)
    expect(new Set(tiles.map((t) => t[2])).size).toBe(1)
    for (const t of tiles) expect(t[0]).toBe(t[1])
  })

  // 카톡처럼 바뀌었다(2026-11-13) — 누르면 새 탭으로 원본을 열던 링크가 아니라 카드 안에서 받는 단추다. 받기 · 열기는 chat-file-card.spec.ts
  test("파일 카드 — 폭 70% · 모서리 13 · 이름 두 줄 말줄임 · 받기 단추 오른쪽 · 공유 단추는 카드 바깥", async ({ page }) => {
    await open(page)
    const card = page.locator(`[data-message-id="${ids.ppt}"] [data-attachment-file]`)
    const g = await card.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      const name = el.querySelector("[data-attachment-name]") as HTMLElement
      const action = el.querySelector("[data-file-action]")!.getBoundingClientRect()
      const share = el.parentElement!.querySelector("[data-file-share]")!.getBoundingClientRect()
      return { w: r.width, radius: cs.borderTopLeftRadius, lines: Math.round(name.getBoundingClientRect().height / 20), clamped: name.scrollHeight > name.clientHeight, actionRight: action.left > name.getBoundingClientRect().right, action: action.width, shareOutside: share.right <= r.left || share.left >= r.right }
    })
    expect(g.w).toBeCloseTo(281.4, 0)
    expect(g).toMatchObject({ radius: "13px", lines: 2, clamped: true, actionRight: true, action: 44, shareOutside: true })
    await expect(card).toHaveAttribute("data-file-state", "idle")
  })

  test("받지 못한 사진은 깨진 표시 대신 안내가 나온다", async ({ page }) => {
    await open(page)
    const failed = page.locator(`[data-message-id="${ids.missing}"] [data-attachment-failed]`)
    await page.locator(`[data-message-id="${ids.missing}"]`).scrollIntoViewIfNeeded()
    await expect(failed).toBeVisible({ timeout: 10_000 })
  })

  test("답장 인용은 말풍선 안 위쪽에 있다", async ({ page }) => {
    await open(page)
    const row = page.locator(`[data-message-id="${ids.reply}"]`)
    await expect(row.locator("[data-reply-in-bubble]")).toBeVisible()
    await expect(row.locator("[data-message-body] > p")).toContainText("에게 답장")
  })

  test("늦게 받은 사진이 칸을 늘려도 맨 아래에 남는다", async ({ page }) => {
    await serveImages(page, 500)
    await login(page, "팀장")
    const at = new Date()
    const id = randomUUID()
    const fileId = randomUUID()
    sizes.set(fileId, [900, 1200])
    await prisma.chatMessage.create({ data: { id, roomId, authorId: (await prisma.user.findFirstOrThrow({ where: { name: "사원1" } })).id, content: "", createdAt: at, changedAt: at } })
    await prisma.file.create({ data: { id: fileId, name: "늦은세로.png", path: `/api/files/${fileId}/raw`, size: 1000, mimeType: "image/png", messageId: id } })
    await prisma.chatRoom.update({ where: { id: roomId }, data: { lastMessageAt: at } })
    await page.goto(`/chat/${roomId}`)
    const img = page.locator(`[data-message-id="${id}"] img`)
    await img.waitFor({ timeout: 30_000 })
    await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.naturalWidth), { timeout: 10_000 }).toBeGreaterThan(0)
    await expect.poll(() => page.locator("section [data-keep-bottom]").first().evaluate((el) => Math.round(el.scrollHeight - el.clientHeight - el.scrollTop)), { timeout: 5_000 }).toBeLessThanOrEqual(1)
    const box = await page.locator(`[data-message-id="${id}"] [data-attachment-image]`).boundingBox()
    expect(box!.height).toBeCloseTo(281.4 * (1200 / 900), 0)
    const pill = await page.locator("section [data-composer-pill]").first().boundingBox()
    expect(box!.y + box!.height).toBeLessThanOrEqual(pill!.y)
  })
})

test.describe("PC", () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  // 지키는 것(2026-11-13 바뀜): PC 도 폰처럼 글 말풍선과 사진 · 파일을 따로 놓는다 — 예전에는 사진이 글 말풍선 안에 들었다
  test("글 말풍선과 사진이 따로 · 사진 이름 줄은 그대로", async ({ page }) => {
    await open(page)
    const body = page.locator(`[data-message-id="${ids.textPhoto}"] [data-message-body]`)
    const inside = await body.evaluate((el) => {
      const p = el.querySelector(":scope > p") as HTMLElement
      const a = el.querySelector("[data-attachment-image]") as HTMLElement
      const caption = a.querySelector("div") as HTMLElement
      return { bodyBg: getComputedStyle(el).backgroundColor, padding: getComputedStyle(p).paddingLeft, radius: getComputedStyle(p).borderTopRightRadius, caption: getComputedStyle(caption).display, imageBelow: a.getBoundingClientRect().top >= p.getBoundingClientRect().bottom }
    })
    expect(inside.bodyBg).toMatch(/rgba\(0, 0, 0, 0\)|transparent/)
    expect(inside.padding).toBe("18px")
    expect(inside.radius).toBe("24px")
    expect(inside.imageBelow).toBe(true)
    expect(inside.caption).not.toBe("none")
    expect(await page.locator(`[data-message-id="${ids.reply}"] [data-reply-in-bubble]`).isVisible()).toBe(false)
    expect(await page.locator(`[data-message-id="${ids.grid}"] [data-attachment-grid]`).evaluate((el) => getComputedStyle(el).display)).toBe("contents")
    // 글 없는 첨부는 빈 글 줄이 자리를 차지하지 않는다
    for (const id of [ids.wide, ids.pdf]) expect(await page.locator(`[data-message-id="${id}"] [data-message-body] > p`).evaluate((el) => el.getBoundingClientRect().height)).toBe(0)
  })
})
