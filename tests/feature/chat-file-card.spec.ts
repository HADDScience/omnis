/**
 * 채팅 파일 카드(카톡처럼) — 카드 안에서 받기(진행 · 취소) → 받은 뒤 누르면 열기 · 공유 단추 · 첨부만 보낸 글에 대괄호 글 없음.
 * 파일 바이트는 page.route 로 준다(데모 빌드는 NAS 가 없다). 방 · 파일 행을 시험 DB 에 넣는다 — 로컬 DB 에서만 돈다.
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
const ids: Record<string, string> = {}
const fileIds: Record<string, string> = {}
let meId = ""
/** 첨부만 보내기 시험 — 올리기(/api/files)는 데모 빌드에서 막혀 있어 미리 만든 내 파일을 돌려준다 */
let pendingUpload: { id: string; name: string; path: string; size: number; mimeType: string } | null = null

/** 아주 작은 PDF 한 장 — 받은 뒤 첫 장 미리보기를 그린다 */
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 260]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
)

async function message(authorId: string, content: string, files: { key: string; name: string; mimeType: string; size: number }[], minutesAgo: number) {
  const at = new Date(Date.now() - minutesAgo * 60_000)
  const id = randomUUID()
  await prisma.chatMessage.create({ data: { id, roomId, authorId, content, createdAt: at, changedAt: at } })
  for (const f of files) {
    const fileId = randomUUID()
    fileIds[f.key] = fileId
    await prisma.file.create({ data: { id: fileId, name: f.name, path: `/api/files/${fileId}/raw`, size: f.size, mimeType: f.mimeType, messageId: id, privateToUserId: authorId } })
  }
  return id
}

test.beforeAll(async () => {
  const me = await prisma.user.findFirstOrThrow({ where: { name: "팀장" } })
  const a = await prisma.user.findFirstOrThrow({ where: { name: "사원1" } })
  meId = me.id
  await prisma.chatRoom.create({ data: { id: roomId, name: "파일 카드 시험", kind: "GROUP", createdById: me.id, lastMessageAt: new Date(), members: { create: [{ userId: me.id }, { userId: a.id }] } } })
  // 옛 화면이 첨부만 보낼 때 넣던 자리글 — DB 는 그대로 두고 화면에서만 숨긴다
  ids.old = await message(me.id, "[파일 2개 첨부]", [
    { key: "report", name: "1_우수사례발표_하드사이언스_261109_WC_01.pdf", mimeType: "application/pdf", size: PDF.length },
    { key: "zip", name: "3_KTL전시_하드사이언스_로고제품사진_261112.zip", mimeType: "application/zip", size: 2_600_000 },
  ], 30)
  ids.other = await message(a.id, "", [{ key: "hwp", name: "회의록.hwp", mimeType: "application/x-hwp", size: 379_000 }], 20)
})
test.afterAll(async () => {
  await prisma?.$disconnect()
})

/** 파일 바이트를 늦게 준다 — 카드 안 진행 상태를 볼 틈 */
async function serveFiles(page: Page, delayMs: number) {
  await page.route("**/api/files/*/raw", async (route) => {
    await new Promise((r) => setTimeout(r, delayMs))
    const id = route.request().url().split("/api/files/")[1].split("/")[0]
    const body = id === fileIds.report ? PDF : Buffer.alloc(1024, 7)
    await route.fulfill({ status: 200, contentType: id === fileIds.report ? "application/pdf" : "application/octet-stream", body }).catch(() => {})
  })
  await page.route("**/api/files", async (route) => {
    if (route.request().method() !== "POST" || !pendingUpload) return route.fallback()
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(pendingUpload) })
  })
}

async function open(page: Page, delayMs = 1500) {
  await serveFiles(page, delayMs)
  await login(page, "팀장")
  await page.goto(`/chat/${roomId}`)
  await page.locator(`[data-message-id="${ids.other}"]`).waitFor({ timeout: 30_000 })
}

const card = (page: Page, key: string) => page.locator(`[data-attachment-file]`).filter({ has: page.locator(`[data-attachment-name]`, { hasText: key }) })

test.describe("PC 1440 @chat", () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  // 지키는 것: 파일을 누르면 바로 열리지 않고 카드 안에서 받기가 진행되며, 받은 뒤 다시 누르면 새 탭으로 열린다. 다시 들어와도 받음이 남는다
  test("받기 진행 → 열기 · 기기에 기억", async ({ page, context }) => {
    await open(page)
    const pdf = card(page, "우수사례발표")
    await expect(pdf).toHaveAttribute("data-file-state", "idle")
    await pdf.locator("[data-file-open]").click()
    await expect(pdf).toHaveAttribute("data-file-state", "downloading")
    await expect(pdf.locator("[data-file-action=cancel]")).toBeVisible()
    await expect(pdf.locator("[data-file-progress]")).toBeVisible()
    await expect(pdf).toHaveAttribute("data-file-state", "done", { timeout: 10_000 })
    // PDF 는 첫 장이 미리보기가 된다
    await expect(pdf.locator("[data-file-thumb]")).toBeVisible({ timeout: 15_000 })
    const [tab] = await Promise.all([context.waitForEvent("page"), pdf.locator("[data-file-open]").click()])
    expect(tab.url()).toMatch(/^blob:/)
    await tab.close()

    // 다시 들어와도 받지 않는다 — 요청 없이 「받음」
    let fetched = 0
    page.on("request", (r) => void (r.url().includes(`/api/files/${fileIds.report}/raw`) && fetched++))
    await page.reload()
    await expect(card(page, "우수사례발표")).toHaveAttribute("data-file-state", "done", { timeout: 30_000 })
    expect(fetched).toBe(0)
  })

  // 지키는 것: 받는 중에 멈출 수 있고, 멈추면 처음 상태로 돌아간다
  test("받기 취소", async ({ page }) => {
    await open(page, 6000)
    const zip = card(page, "로고제품사진")
    await zip.locator("[data-file-action=download]").click()
    await expect(zip).toHaveAttribute("data-file-state", "downloading")
    await zip.locator("[data-file-action=cancel]").click()
    await expect(zip).toHaveAttribute("data-file-state", "idle")
  })

  // 지키는 것: PC 도 폰처럼 파일이 한 장씩 따로 놓이고, 옛 「[파일 N개 첨부]」 글자와 「모두 저장」 단추는 보이지 않는다
  test("카드가 하나씩 · 대괄호 글 없음 · 모두 저장 숨김 · 공유 단추는 말풍선 바깥", async ({ page }) => {
    await open(page)
    const row = page.locator(`[data-message-id="${ids.old}"]`)
    await expect(row.locator("[data-attachment-file]")).toHaveCount(2)
    await expect(row).not.toContainText("[파일")
    await expect(row.locator("[data-message-body] > p")).toBeHidden()
    await expect(row.locator("[data-save-all]")).toBeHidden()
    // 카드는 저마다 떨어져 있다 — 한 덩어리 말풍선 배경이 없다
    const bg = await row.locator("[data-message-body]").evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(bg).toMatch(/rgba\(0, 0, 0, 0\)|transparent/)
    // 공유 단추는 카드 바깥 — 내 글은 카드 왼쪽
    const g = await row.locator("[data-attachment-file-row]").first().evaluate((el) => {
      const c = el.querySelector("[data-attachment-file]")!.getBoundingClientRect()
      const s = el.querySelector("[data-file-share]")!.getBoundingClientRect()
      return { shareRight: s.right, cardLeft: c.left }
    })
    expect(g.shareRight).toBeLessThanOrEqual(g.cardLeft)
    // 목록 미리보기 · 답장 인용도 대괄호 없이
    const rooms = (await (await page.request.get("/api/chat/rooms")).json()) as { rooms?: { id: string; preview: string | null }[] } | { id: string; preview: string | null }[]
    const list = Array.isArray(rooms) ? rooms : (rooms.rooms ?? [])
    const mine = list.find((r) => r.id === roomId)
    if (mine?.preview) expect(mine.preview).not.toContain("[파일")
  })

  // 지키는 것: 글 없이 첨부만 보내면 본문이 비어 카드만 보인다(대괄호 자리글을 넣지 않는다)
  test("첨부만 보낸 글에 대괄호 글이 없다", async ({ page }) => {
    const fileId = randomUUID()
    pendingUpload = { id: fileId, name: "첨부만.pdf", path: `/api/files/${fileId}/raw`, size: PDF.length, mimeType: "application/pdf" }
    await prisma.file.create({ data: { ...pendingUpload, privateToUserId: meId } })
    await open(page)
    const input = page.locator("[data-composer-file-input]").first()
    await expect(async () => {
      await input.setInputFiles([])
      await input.setInputFiles({ name: "첨부만.pdf", mimeType: "application/pdf", buffer: PDF })
      await expect(page.getByRole("button", { name: "첨부만.pdf 빼기" })).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 30_000 })
    await page.getByRole("button", { name: "보내기", exact: true }).click()
    const sent = page.locator("[data-message-id]").filter({ has: page.locator("[data-attachment-name]", { hasText: "첨부만.pdf" }) }).last()
    await expect(sent).toBeVisible({ timeout: 20_000 })
    await expect.poll(async () => (await prisma.file.findUnique({ where: { id: fileId }, select: { message: { select: { content: true } } } }))?.message?.content, { timeout: 20_000 }).toBe("")
    await expect(sent).not.toContainText("[파일")
    await expect(sent.locator("[data-message-body] > p")).toBeHidden()
    pendingUpload = null
  })
})

test.describe("폰 390 @mobile", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  // 지키는 것: 폰에서 받은 파일을 다시 누르면 공유 시트(미리보기 · 저장)로 열린다
  test("받기 → 공유 시트로 열기", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __shared: string[] }
      w.__shared = []
      Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true })
      Object.defineProperty(navigator, "share", { value: async (d: { files?: File[] }) => void w.__shared.push(d.files?.[0]?.name ?? "url"), configurable: true })
    })
    await open(page, 800)
    const hwp = card(page, "회의록.hwp")
    await hwp.locator("[data-file-open]").click()
    await expect(hwp).toHaveAttribute("data-file-state", "done", { timeout: 10_000 })
    await hwp.locator("[data-file-open]").click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { __shared: string[] }).__shared)).toEqual(["회의록.hwp"])
    // 가로로 넘치지 않는다
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})
