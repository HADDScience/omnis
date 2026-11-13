/**
 * 파일 보내기(카톡처럼) — 고르면 확인 없이 바로 내 카드가 뜨고, 카드 안에서 「업로드 중 · a / b」 · 원형 진행 · X.
 * 다 올라가면 보낸 파일 카드로 바뀐다. X 로 멈추면 카드가 사라지고 글이 저장되지 않는다. 실패하면 카드에 「다시 보내기」.
 * 실제 저장은 가짜 NAS 로 간다(scripts/e2e-fake-nas.mjs). 입력창 첨부는 NEXT_PUBLIC_E2E_ATTACH=1 인 시험 빌드에서만 열린다.
 */
import { randomUUID } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { login } from "./_setup"

const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")
test.skip(!LOCAL_DB, "시험 DB 를 직접 고친다")
test.skip(!process.env.E2E_FAKE_NAS_URL, "가짜 NAS 가 없다(E2E_FAKE_NAS_URL)")
test.describe.configure({ mode: "serial" })

const prisma = LOCAL_DB ? new PrismaClient() : (null as unknown as PrismaClient)
const roomId = randomUUID()

test.beforeAll(async () => {
  const me = await prisma.user.findFirstOrThrow({ where: { name: "팀장" } })
  const a = await prisma.user.findFirstOrThrow({ where: { name: "사원1" } })
  await prisma.chatRoom.create({ data: { id: roomId, name: "파일 보내기 시험", kind: "GROUP", createdById: me.id, lastMessageAt: new Date(), members: { create: [{ userId: me.id }, { userId: a.id }] } } })
  const at = new Date(Date.now() - 60_000)
  await prisma.chatMessage.create({ data: { roomId, authorId: a.id, content: "자료 보내 주세요", createdAt: at, changedAt: at } })
})
test.afterAll(async () => {
  await prisma?.$disconnect()
})

async function open(page: Page) {
  await login(page, "팀장")
  await page.goto(`/chat/${roomId}`)
  await page.locator("[data-message-id]").getByText("자료 보내 주세요", { exact: true }).waitFor({ timeout: 30_000 })
}

const pick = (page: Page, files: { name: string; bytes: number }[]) =>
  page.locator("[data-composer-file-input]").first().setInputFiles(files.map((f) => ({ name: f.name, mimeType: "application/pdf", buffer: Buffer.alloc(f.bytes, 1) })))

const card = (page: Page, name: string) => page.locator("[data-attachment-file]").filter({ has: page.locator("[data-attachment-name]", { hasText: name }) })

/** 올리기 응답을 늦춘다 — 카드 안 진행 상태를 볼 틈 */
async function slowUploads(page: Page, ms: number) {
  await page.route("**/api/files", async (route) => {
    if (route.request().method() !== "POST") return route.fallback()
    await new Promise((r) => setTimeout(r, ms))
    await route.continue().catch(() => {})
  })
}

const savedWith = (name: string) => prisma.chatMessage.count({ where: { roomId, files: { some: { name } } } })

test.describe("PC 1440 @chat", () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  // 지키는 것: 파일을 고르면 확인 없이 바로 내 카드가 떠서 진행을 보이고, 다 올라가면 보낸 파일 카드(받기 단추 · 용량)가 된다. 여러 개는 카드도 여러 장
  test("업로드 진행 → 보낸 카드", async ({ page }) => {
    await slowUploads(page, 2500)
    await open(page)
    await pick(page, [{ name: "보고서_진행.pdf", bytes: 300_000 }, { name: "부록_진행.pdf", bytes: 120_000 }])
    const a = card(page, "보고서_진행.pdf")
    const b = card(page, "부록_진행.pdf")
    // 입력창에 칩으로 모이지 않고 대화에 바로 뜬다
    await expect(page.getByRole("button", { name: "보고서_진행.pdf 빼기" })).toHaveCount(0)
    await expect(a).toHaveAttribute("data-file-state", "uploading")
    await expect(b).toHaveAttribute("data-file-state", "uploading")
    await expect(a.locator("[data-file-meta]")).toContainText(/업로드 중 · \d+ \/ 293KB/)
    await expect(a.locator("[data-file-action=cancel-upload]")).toBeVisible()
    await expect(a.locator("[data-file-progress]")).toBeVisible()
    // 다 올라가면 보낸 카드 — 받기 단추 · 형식 · 용량
    await expect(a).toHaveAttribute("data-file-state", "idle", { timeout: 20_000 })
    await expect(b).toHaveAttribute("data-file-state", "idle", { timeout: 20_000 })
    await expect(a.locator("[data-file-action=download]")).toBeVisible()
    await expect(a.locator("[data-file-meta]")).toHaveText("PDF · 293KB")
    await expect.poll(() => savedWith("보고서_진행.pdf")).toBe(1)
    await expect.poll(() => savedWith("부록_진행.pdf")).toBe(1)
    // 본문은 비어 있다 — 대괄호 자리글 없이 카드만
    const row = page.locator("[data-message-id]").filter({ has: a })
    await expect(row).not.toContainText("[파일")
  })

  // 지키는 것: 올리는 중 X 를 누르면 그 카드가 사라지고 글이 저장되지 않는다
  test("업로드 취소", async ({ page }) => {
    await slowUploads(page, 8000)
    await open(page)
    await pick(page, [{ name: "취소할_파일.pdf", bytes: 200_000 }])
    const c = card(page, "취소할_파일.pdf")
    await expect(c).toHaveAttribute("data-file-state", "uploading")
    await c.locator("[data-file-action=cancel-upload]").click()
    await expect(c).toHaveCount(0)
    await page.waitForTimeout(9000)
    expect(await savedWith("취소할_파일.pdf")).toBe(0)
    await expect(card(page, "취소할_파일.pdf")).toHaveCount(0)
  })

  // 지키는 것: 올리지 못하면 카드가 남아 「다시 보내기」 를 보이고, 누르면 다시 올려 보낸다
  test("실패 → 다시 보내기", async ({ page }) => {
    let fail = true
    await page.route("**/api/files", async (route) => {
      if (route.request().method() !== "POST") return route.fallback()
      if (fail) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "저장소가 응답하지 않습니다" }) })
      await route.continue()
    })
    await open(page)
    await pick(page, [{ name: "다시보낼_파일.pdf", bytes: 50_000 }])
    const c = card(page, "다시보낼_파일.pdf")
    await expect(c).toHaveAttribute("data-file-state", "send-failed", { timeout: 10_000 })
    await expect(c.locator("[data-file-meta]")).toHaveText("보내지 못했어요")
    fail = false
    await c.locator("[data-file-action=retry]").click()
    await expect(c).toHaveAttribute("data-file-state", "idle", { timeout: 20_000 })
    await expect.poll(() => savedWith("다시보낼_파일.pdf")).toBe(1)
  })
})

test.describe("폰 390 @mobile", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  // 지키는 것: 폰도 같은 카드 — 고르면 바로 뜨고 진행 뒤 보낸 카드가 된다. 가로로 넘치지 않는다
  test("업로드 진행 → 보낸 카드", async ({ page }) => {
    await slowUploads(page, 1500)
    await open(page)
    await pick(page, [{ name: "폰에서_보냄.pdf", bytes: 80_000 }])
    const c = card(page, "폰에서_보냄.pdf")
    await expect(c).toHaveAttribute("data-file-state", "uploading")
    await expect(c).toHaveAttribute("data-file-state", "idle", { timeout: 20_000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})
