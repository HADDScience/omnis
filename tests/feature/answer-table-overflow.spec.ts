/**
 * 옴니스 답의 넓은 표 — 좁은 폭(오른쪽 패널 · 폰)에서 칸 글이 잘리지 않고 줄을 바꾸며, 표 상자가 가로로 밀린다(터치 포함).
 * 칸을 끌어 고르는 선택 상자(#188)는 줄이 바뀌어 높이가 달라진 칸에도, 가로로 민 뒤에도 칸 경계에 맞는다.
 * 넓은 표 답 방을 시험 DB 에 직접 넣는다 — 로컬 DB(CI · e2e-local)에서만. CSS: app/globals.css 「읽기 전용 표 … 좁은 폭」.
 */
import { randomUUID } from "node:crypto"
import { expect, test, type Browser, type BrowserContextOptions, type Locator, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { quickLogin } from "./_setup"

const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")
test.skip(!LOCAL_DB, "시험 DB 를 직접 고친다")
test.describe.configure({ mode: "serial" })

const prisma = LOCAL_DB ? new PrismaClient() : (null as unknown as PrismaClient)
let queryId: string | null = null
const ROOM = `wide-table-${randomUUID()}`
const LONG_URL = "https://example.com/very/long/path/to/the/regulatory/document/file-name.pdf"
const ANSWER = [
  "지원사업 네 건의 현황입니다.",
  "",
  "| 사업명 | 주관 기관 | 담당 | 현재 단계 | 마감 | 남은 서류 | 메모 |",
  "|---|---|---|---|---|---|---|",
  "| 바이오 소재 실증연구 지원사업 | 한국산업기술진흥원 | 사원1 | 서류 보완 요청 대응 | 11월 14일 | 가산점 증빙(특허 등록증 사본), 재무제표 3개년 | 보완 요청 메일이 11월 7일에 왔고 담당 연구원 확인이 필요합니다 |",
  "| 공급망 안정화 선도사업 | 산업통상자원부 | 부팀장 | 신청서 검토 | 11월 11일 | 사업계획서 최종본 | 예산표 합계가 본문과 다릅니다 |",
  `| 제품 B 인허가 | 식품의약품안전처 | 부팀장 | 일정표 작성 | 11월 10일 | 시험성적서 | ${LONG_URL} |`,
  "| 해외 전시 참가 지원 | 지역 테크노파크 | 사원2 | 접수 완료 | 12월 2일 | 없음 | 부스 배정 결과 대기 |",
].join("\n")

test.beforeAll(async () => {
  const owner = await prisma.user.findFirstOrThrow({ where: { name: "부팀장" } })
  const system = await prisma.user.upsert({
    where: { id: "system" },
    update: {},
    create: { id: "system", name: "Omnis", passwordHash: "!", role: "MEMBER", isActive: false, position: "시스템" },
  })
  // 패널은 가장 최근 옴니스 방을 연다 — 이 방이 맨 위로 오게 지금 시각
  await prisma.chatRoom.create({ data: { id: ROOM, name: "시험 — 넓은 표", kind: "OMNIS_DM", createdById: owner.id, lastMessageAt: new Date(), members: { create: { userId: owner.id } } } })
  const q = "지원사업 현황을 표로"
  await prisma.chatMessage.create({ data: { roomId: ROOM, authorId: owner.id, content: q, createdAt: new Date(Date.now() - 60_000) } })
  const query = await prisma.omnisQuery.create({ data: { userId: owner.id, question: q, answer: ANSWER, sources: [] } })
  queryId = query.id
  await prisma.chatMessage.create({ data: { roomId: ROOM, authorId: system.id, content: ANSWER, omnisQueryId: query.id } })
})
test.afterAll(async () => {
  // 글 → 방은 RESTRICT — 글부터 지운다
  await prisma?.chatMessage.deleteMany({ where: { roomId: ROOM } })
  if (queryId) await prisma?.omnisQuery.delete({ where: { id: queryId } }).catch(() => {})
  await prisma?.chatRoom.delete({ where: { id: ROOM } })
  await prisma?.$disconnect()
})

async function open(browser: Browser, device: BrowserContextOptions) {
  const ctx = await browser.newContext({ ...device, permissions: ["clipboard-read", "clipboard-write"] })
  const page = await ctx.newPage()
  await page.addInitScript(() => {
    localStorage.setItem("omnis:nudge-off:install", "1")
    localStorage.setItem("omnis:nudge-off:push", "1")
  })
  await quickLogin(page, "부팀장")
  return { ctx, page }
}

/** 표 상자의 넘침 · 칸 잘림 */
const layout = (sheet: Locator) =>
  sheet.evaluate((el) => {
    const cells = [...el.querySelectorAll("td")]
    return {
      overflowX: getComputedStyle(el).overflowX,
      scrollW: el.scrollWidth,
      clientW: el.clientWidth,
      clipped: cells.filter((td) => td.scrollWidth > td.clientWidth + 1 || td.scrollHeight > td.clientHeight + 1).map((td) => td.textContent),
      nowrap: cells.filter((td) => getComputedStyle(td.querySelector(".Spreadsheet__data-viewer") ?? td).whiteSpace === "nowrap").length,
      ellipsis: cells.filter((td) => getComputedStyle(td).textOverflow === "ellipsis").length,
      narrowest: Math.min(...cells.map((td) => td.getBoundingClientRect().width)),
      tallest: Math.max(...cells.map((td) => td.getBoundingClientRect().height)),
      cellH: cells[0]?.getBoundingClientRect().height ?? 0,
    }
  })

async function expectScrollsWithoutClipping(sheet: Locator) {
  const l = await layout(sheet)
  expect(l.overflowX).toBe("auto")
  expect(l.clipped).toEqual([])
  expect(l.nowrap).toBe(0)
  expect(l.ellipsis).toBe(0)
  // 좁은 폭에서는 상자보다 넓어 가로로 밀린다
  expect(l.scrollW).toBeGreaterThan(l.clientW + 20)
  // 칸은 최소 폭을 지키고, 긴 글은 여러 줄로 바뀐다
  expect(l.narrowest).toBeGreaterThanOrEqual(58)
  expect(l.tallest).toBeGreaterThan(l.cellH + 10)
}

const cell = (sheet: Locator, r: number, c: number) => sheet.locator("tbody tr:has(td)").nth(r).locator("td").nth(c)

/** 두 칸을 마우스로 끌어 고르고 선택 상자가 칸 경계에 맞는지 */
async function dragSelectAligned(page: Page, sheet: Locator, from: [number, number], to: [number, number]) {
  const a = (await cell(sheet, ...from).boundingBox())!
  const b = (await cell(sheet, ...to).boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 })
  await page.mouse.up()
  const rect = (await sheet.locator(".Spreadsheet__floating-rect--selected").boundingBox())!
  expect(Math.abs(rect.y - a.y)).toBeLessThan(2)
  expect(Math.abs(rect.y + rect.height - (b.y + b.height))).toBeLessThan(2)
  expect(Math.abs(rect.x - a.x)).toBeLessThan(2)
  expect(Math.abs(rect.x + rect.width - (b.x + b.width))).toBeLessThan(2)
}

test("PC 본문 — 넓은 표는 칸이 잘리지 않고 상자가 가로로 밀린다", async ({ browser }) => {
  const { ctx, page } = await open(browser, { viewport: { width: 1280, height: 860 } })
  await page.goto(`/chat/${ROOM}`)
  const sheet = page.locator("[data-omnis-message][id^=\"m-\"] [data-copyable-sheet]").first()
  await expect(sheet).toBeVisible({ timeout: 15_000 })
  await expectScrollsWithoutClipping(sheet)
  await ctx.close()
})

test("PC 오른쪽 패널 — 잘리지 않고 밀리며, 머리글부터 끌어 고른 상자가 여러 줄 칸에도 맞고 복사는 글 전체", async ({ browser }) => {
  const { ctx, page } = await open(browser, { viewport: { width: 1440, height: 900 } })
  await page.goto("/tasks")
  await page.getByRole("button", { name: /^대화 패널 열기/ }).click()
  await page.getByRole("group", { name: "패널 보기" }).getByRole("button", { name: /옴니스/ }).click()
  const sheet = page.locator("[data-copyable-sheet]").filter({ visible: true }).first()
  await expect(sheet).toContainText("시험성적서", { timeout: 15_000 })
  const box = (await sheet.boundingBox())!
  expect(box.width).toBeLessThan(420)
  await expectScrollsWithoutClipping(sheet)

  // 머리글(0 줄) ~ 여러 줄로 바뀐 칸(1 줄 사업명)
  await dragSelectAligned(page, sheet, [0, 0], [1, 1])
  // 끝까지 민 뒤 — 마지막 열(메모)의 긴 주소 칸도 상자가 맞고, 복사하면 잘림 없이 전체
  await sheet.evaluate((el) => (el.scrollLeft = el.scrollWidth))
  await expect.poll(() => sheet.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
  await dragSelectAligned(page, sheet, [0, 6], [3, 6])
  await page.keyboard.press("ControlOrMeta+c")
  const text = await page.evaluate(() => navigator.clipboard.readText())
  expect(text).toContain(LONG_URL)
  expect(text.split("\n")[0]).toBe("메모")
  await ctx.close()
})

test("폰 — 잘리지 않고, 손가락으로 표를 옆으로 밀 수 있다", async ({ browser }) => {
  const { ctx, page } = await open(browser, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  await page.goto(`/chat/${ROOM}`)
  const sheet = page.locator("[data-omnis-message][id^=\"m-\"] [data-copyable-sheet]").first()
  await expect(sheet).toBeVisible({ timeout: 15_000 })
  await expectScrollsWithoutClipping(sheet)
  // 화면도 옆으로 넘치지 않는다 — 넘침은 표 상자 안에서만
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  const b = (await sheet.boundingBox())!
  const cdp = await page.context().newCDPSession(page)
  const y = b.y + Math.min(b.height / 2, 60)
  const x0 = b.x + b.width - 30
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y }] })
  for (let i = 1; i <= 12; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 - i * 20, y }] })
    await page.waitForTimeout(16)
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  await expect.poll(() => sheet.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100)
  await ctx.close()
})
