/**
 * 방 서랍 + 파일 한 번에 받기 (2026-11-12)
 *
 * 지키는 것:
 *   - 방 머리 ≡ → 서랍. PC 는 오른쪽 칸(440px), 폰은 전체 시트이고 가로로 넘치지 않는다
 *   - 사진(최신순 격자) · 파일(이름 · 크기 · 보낸 사람 · 날짜) · 링크 · 참여자 탭, 기간 · 종류 필터
 *   - 카톡 자리표시(첨부 없는 「File: …」)는 「원본에만 있음」 으로 알리고, 받은 zip 에 빠진파일.txt 를 넣는다
 *   - PC 「N개 받기」: 브라우저가 파일을 하나씩 받아 zip 으로 묶는다 — 안 이름은 방이름_YYMM/YYYY-MM-DD_보낸사람_원래이름, 겹치면 번호
 *   - 폰에서 사진만 고르면 공유 시트(navigator.share files)로 넘긴다
 *   - 하단 진행 표시 · 취소, 묶음 글의 「모두 저장」
 *   - 권한: 방 밖 사람은 서랍 · 받기 API 가 막히고, 다른 방의 파일 id 는 받기에서 빠진다
 * 파일 실물은 쓰지 않는다: /raw · /thumb 를 이 자리에서 만든 바이트로 대신 받는다.
 */
import "dotenv/config"
import { randomUUID } from "node:crypto"
import sharp from "sharp"
import JSZip from "jszip"
import { expect, test, type Page } from "@playwright/test"
import { prisma } from "../../lib/db"
import { quickLogin } from "./_setup"

const stamp = Date.now().toString(36)
const ROOM = `drawer-${stamp}`
const ROOM_NAME = `서랍시험${stamp.slice(-4)}`
const created = { messages: [] as string[], files: [] as string[], rooms: [] as string[] }
let me: string
let peer: string
let png: Buffer
const ids: Record<string, string> = {}

async function message(authorId: string, content: string, at: Date, files: { name: string; mimeType: string; size: number; key: string }[] = [], sourceId?: string) {
  const m = await prisma.chatMessage.create({ data: { roomId: ROOM, authorId, content, createdAt: at, ...(sourceId ? { sourceId } : {}) } })
  created.messages.push(m.id)
  for (const [i, f] of files.entries()) {
    const id = randomUUID()
    // 사람 방의 첨부는 올린 사람 전용 표시를 달고 붙는다(lib/file-access.ts)
    await prisma.file.create({ data: { id, name: f.name, path: `/api/files/${id}/raw`, size: f.size, mimeType: f.mimeType, messageId: m.id, privateToUserId: authorId, createdAt: new Date(at.getTime() + i) } })
    created.files.push(id)
    ids[f.key] = id
  }
  return m.id
}

test.beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL!)
  if (!["localhost", "127.0.0.1", "::1"].includes(target.hostname)) throw new Error("방 서랍 E2E는 로컬 DB만 사용합니다.")
  me = (await prisma.user.findFirstOrThrow({ where: { name: "팀장" } })).id
  peer = (await prisma.user.findFirstOrThrow({ where: { name: "사원1" } })).id
  png = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#7799cc" } }).png().toBuffer()
  await prisma.chatRoom.create({ data: { id: ROOM, name: ROOM_NAME, kind: "GROUP", createdById: me, lastMessageAt: new Date(), members: { create: [{ userId: me }, { userId: peer }] } } })
  created.rooms.push(ROOM)
  const now = Date.now()
  await message(peer, "옛 견적", new Date(now - 60 * 86400_000), [{ name: "옛견적.pdf", mimeType: "application/pdf", size: 3000, key: "oldPdf" }])
  await message(peer, "", new Date(now - 5000), [
    { name: "현장.png", mimeType: "image/png", size: png.length, key: "photoA" },
    { name: "현장.png", mimeType: "image/png", size: png.length, key: "photoB" },
  ])
  await message(me, "", new Date(now - 4000), [
    { name: "회의록.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 2048, key: "doc" },
    { name: "매출.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: 4096, key: "sheet" },
  ])
  await message(peer, "자료는 https://example.com/report?id=1 에 있어요.", new Date(now - 3000))
  // 카톡에서 옮긴 글 — 첨부 실물 없이 자리표시만 남았다
  await message(peer, "File: 원본없는계약서.pdf", new Date(now - 2000), [], `kakao:drawer-${stamp}`)
})

test.afterAll(async () => {
  await prisma.file.deleteMany({ where: { id: { in: created.files } } })
  await prisma.chatMessage.deleteMany({ where: { id: { in: created.messages } } })
  await prisma.chatRoom.deleteMany({ where: { id: { in: created.rooms } } })
  await prisma.$disconnect()
})

async function open(page: Page, user: "팀장" | "사원2" = "팀장") {
  await page.route(/\/api\/files\/[^/]+\/(raw|thumb)/, (route) => {
    const id = route.request().url().match(/files\/([^/]+)\//)![1]
    const isPhoto = id === ids.photoA || id === ids.photoB
    return route.fulfill({ status: 200, contentType: isPhoto ? "image/png" : "application/octet-stream", body: isPhoto ? png : Buffer.from(`bytes-of-${id}`) })
  })
  // 크롬의 저장 위치 창은 시험에서 열 수 없다 — 모아서 내려받는 길로
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker
  })
  await quickLogin(page, user)
  await page.goto(`/chat/${ROOM}`)
}

const drawer = (page: Page) => page.getByRole("dialog", { name: `${ROOM_NAME} 서랍` })
const openDrawer = async (page: Page) => {
  await page.locator("[data-room-header] [data-room-drawer-button]").click()
  await expect(drawer(page)).toBeVisible()
}

test.describe("PC", () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test("≡ → 오른쪽 서랍 · 사진 최신순 · 파일 이름/크기/보낸 사람 · 기간 · 종류 · 링크 · 참여자", async ({ page }) => {
    await open(page)
    await openDrawer(page)
    // 화면 배율(--ui-zoom 1.1)이 걸려 css 440px 이 화면에서 484px 이다 — 화면 폭의 1/3 안팎, 오른쪽 끝에 붙는다
    const box = (await drawer(page).boundingBox())!
    expect(box.width).toBeGreaterThan(420)
    expect(box.width).toBeLessThan(520)
    expect(box.x + box.width).toBeGreaterThan(1400)

    // 사진 — 같은 글의 두 장. 로컬 dev 는 서랍 API 를 처음 부를 때 컴파일하느라 늦다
    await expect(drawer(page).locator("[data-drawer-photo]")).toHaveCount(2, { timeout: 30_000 })
    // 누르면 뷰어가 서랍 위에 뜬다
    await drawer(page).locator("[data-drawer-photo]").first().click()
    await expect(page.getByRole("dialog", { name: "사진 보기" })).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog", { name: "사진 보기" })).toHaveCount(0)
    await expect(drawer(page)).toBeVisible()

    await drawer(page).getByRole("tab", { name: "파일" }).click()
    const files = drawer(page).locator("[data-drawer-file]")
    await expect(files).toHaveCount(3)
    await expect(files.first()).toContainText("회의록.docx")
    await expect(files.first()).toContainText("2KB · 팀장")
    await expect(drawer(page).locator("[data-drawer-missing]")).toContainText("카톡 원본에만 있는 1개")

    await drawer(page).getByRole("button", { name: "이번 주" }).click()
    await expect(files).toHaveCount(2) // 60일 전 견적은 빠진다
    await drawer(page).getByRole("button", { name: "전체" }).click()
    await drawer(page).getByRole("button", { name: "PDF", exact: true }).click()
    await expect(files).toHaveCount(1)
    await expect(files.first()).toContainText("옛견적.pdf")

    await drawer(page).getByRole("tab", { name: "링크" }).click()
    await expect(drawer(page).locator("[data-drawer-link]")).toHaveCount(1)
    await expect(drawer(page).locator("[data-drawer-link]")).toHaveAttribute("href", "https://example.com/report?id=1")

    await drawer(page).getByRole("tab", { name: "참여자" }).click()
    await expect(drawer(page).locator("[data-drawer-member]")).toHaveText([/팀장/, /사원1/])

    await page.keyboard.press("Escape")
    await expect(drawer(page)).toHaveCount(0)
  })

  test("N개 받기 — 브라우저에서 zip 으로 묶고, 이름 규칙 · 겹침 번호 · 빠진파일.txt", async ({ page }) => {
    await open(page)
    await openDrawer(page)
    await drawer(page).getByRole("tab", { name: "파일" }).click()
    await drawer(page).getByRole("button", { name: "선택", exact: true }).click()
    await drawer(page).getByRole("button", { name: "모두 선택" }).click()
    await expect(drawer(page).locator("[data-drawer-missing-note]")).toContainText("1개는 원본 없음")
    const button = drawer(page).locator("[data-drawer-download]")
    await expect(button).toHaveText(/^3개 받기 · /)
    const [download] = await Promise.all([page.waitForEvent("download"), button.click()])
    expect(download.suggestedFilename()).toMatch(new RegExp(`^${ROOM_NAME}_\\d{4}\\.zip$`))
    const zip = await JSZip.loadAsync(await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c)))
    const names = Object.keys(zip.files)
    expect(names).toHaveLength(4)
    expect(names.every((n) => n.startsWith(`${ROOM_NAME}_`))).toBe(true)
    expect(names.some((n) => /\/\d{4}-\d{2}-\d{2}_팀장_회의록\.docx$/.test(n))).toBe(true)
    expect(names.some((n) => /\/\d{4}-\d{2}-\d{2}_사원1_옛견적\.pdf$/.test(n))).toBe(true)
    const missing = names.find((n) => n.endsWith("/빠진파일.txt"))!
    expect(await zip.file(missing)!.async("string")).toContain("원본없는계약서.pdf")
    expect(await zip.file(names.find((n) => n.endsWith("회의록.docx"))!)!.async("string")).toBe(`bytes-of-${ids.doc}`)
    // 하단 진행 표시가 끝을 알린다
    await expect(page.locator("[data-room-download=done]")).toBeVisible()

    // 사진 두 장은 이름이 같다 — 번호가 붙는다
    await drawer(page).getByRole("tab", { name: "사진" }).click()
    await drawer(page).getByRole("button", { name: "선택", exact: true }).click()
    await drawer(page).getByRole("button", { name: "모두 선택" }).click()
    const [photos] = await Promise.all([page.waitForEvent("download"), drawer(page).locator("[data-drawer-download]").click()])
    const pz = await JSZip.loadAsync(Buffer.concat(await (await photos.createReadStream()).toArray()))
    expect(Object.keys(pz.files).map((n) => n.split("/")[1].replace(/^\d{4}-\d{2}-\d{2}_/, "")).sort()).toEqual(["사원1_현장 (2).png", "사원1_현장.png"])
  })

  // 지키는 것: 받는 중에 멈출 수 있다. 묶음 글의 「모두 저장」 은 숨겼다(2026-11-13) — 여러 개 받기는 서랍에서 골라 받는다
  test("받는 중 취소 · 묶음 글의 「모두 저장」 은 숨김", async ({ page }) => {
    await open(page)
    // 받기를 늦춰 멈출 틈을 만든다
    await page.route(/\/api\/files\/[^/]+\/raw$/, async (route) => {
      await new Promise((r) => setTimeout(r, 4000))
      await route.fulfill({ status: 200, body: "slow" }).catch(() => {})
    })
    await expect(page.locator("[data-save-all]")).toHaveCount(2) // 코드는 남아 있다 — 사진 두 장 글 · 문서 두 개 글
    for (const b of await page.locator("[data-save-all]").all()) await expect(b).toBeHidden()
    await openDrawer(page)
    await drawer(page).getByRole("tab", { name: "파일" }).click()
    await drawer(page).getByRole("button", { name: "선택", exact: true }).click()
    await drawer(page).getByRole("button", { name: "모두 선택" }).click()
    await drawer(page).locator("[data-drawer-download]").click()
    const status = page.locator("[data-room-download-status]")
    await expect(status).toContainText(`${ROOM_NAME} · `)
    await status.getByRole("button", { name: /받기 멈추기$/ }).click()
    await expect(status).toContainText("멈췄습니다")
  })

  test("권한 — 방 밖 사람은 서랍 · 받기가 막히고, 다른 방 파일은 받기에서 빠진다", async ({ page }) => {
    await quickLogin(page, "사원2")
    const list = await page.request.get(`/api/chat/drawer?roomId=${ROOM}&tab=files`)
    expect(list.status()).toBe(403)
    const dl = await page.request.post("/api/chat/drawer/download", { data: { roomId: ROOM, fileIds: [ids.doc] } })
    expect(dl.status()).toBe(403)
    // 전사방은 모두 열리지만, 이 단톡방의 파일 id 를 섞어도 주소가 나오지 않는다
    const company = await page.request.post("/api/chat/drawer/download", { data: { roomId: "default-room", fileIds: [ids.doc] } })
    expect(company.status()).toBe(200)
    expect(await company.json()).toEqual({ files: [], skipped: 1 })
  })
})

test.describe("폰", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test("전체 시트 · 가로 넘침 없음 · 사진은 공유 시트로", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __shared: number[] }
      w.__shared = []
      Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true })
      Object.defineProperty(navigator, "share", { value: async (d: { files: File[] }) => void w.__shared.push(d.files.length), configurable: true })
    })
    await open(page)
    await openDrawer(page)
    // 화면 배율(1.1)을 거친 폭이라 소수점 아래가 남는다(CI 389.99998)
    const box = (await drawer(page).boundingBox())!
    expect(box.width).toBeCloseTo(390, 0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0)
    await drawer(page).getByRole("button", { name: "선택", exact: true }).click()
    await drawer(page).locator("[data-drawer-photo]").first().click()
    await drawer(page).locator("[data-drawer-photo]").nth(1).click()
    await drawer(page).locator("[data-drawer-download]").click()
    const share = page.locator("[data-room-download-status]").getByRole("button", { name: "사진에 저장" })
    await share.click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { __shared: number[] }).__shared)).toEqual([2])
  })
})
