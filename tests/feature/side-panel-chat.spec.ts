/**
 * PC 오른쪽 패널 = 폰 채팅 탭(2026-11-11) — 방 목록 → 방 → 대화, 옴니스 대화도 목록의 방 하나.
 * 지키는 것:
 *   - 패널에서 방을 옮겨도 본문 주소는 그대로(업무 화면에서 옆에 띄워 둔 채 채팅)
 *   - ← 로 목록, 「새 대화 → 옴니스와 대화」 는 패널 안의 새 옴니스 대화
 *   - nav 「채팅」 을 누르면 패널이 닫히고, 패널에서 마지막으로 보던 방이 본문에 열린다 · 패널을 다시 열면 그 방
 *   - 패널 폭(400px)에서 긴 표 · 긴 주소가 패널을 넘치지 않는다(표는 표 안에서 가로로 민다)
 *   - ?taskId= 링크는 패널의 그 업무방으로
 * 계획: mydocs/plans/2026-11-11-side-panel-chat.md · 규칙 단위 시험: lib/panel-chat-rules.test.ts
 * 화면 캡처: SIDE_PANEL_SHOTS=<폴더> 를 주면 PC 1440 · 1280 과 폰 폭을 남긴다.
 */
import path from "node:path"
import { expect, test, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { login } from "./_setup"

const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")
test.skip(!LOCAL_DB, "시험 DB 에 넓은 표가 든 옴니스 대화를 넣는다")

const prisma = LOCAL_DB ? new PrismaClient() : (null as unknown as PrismaClient)
const shots = process.env.SIDE_PANEL_SHOTS
const stamp = Date.now()
const ROOM_NAME = `패널 표 시험 ${stamp}`
let omnisRoomId = ""
let task: { id: string; name: string }

const WIDE_TABLE = [
  "견적 비교표입니다.",
  "",
  "| 품목 | 규격 | 수량 | 단가 | 공급사 | 납기 | 비고 |",
  "|---|---|---|---|---|---|---|",
  "| 하이드로젤 시약 A | 10mL × 12 | 4 | 182,000원 | 가나다 바이오 | 2주 | 냉장 배송 · 수령 즉시 확인 |",
  "| 배양 플레이트 96웰 | 평저 · 멸균 | 20 | 7,400원 | 라마바 과학 | 3일 | 묶음 할인 적용 |",
  "| 피펫 팁 200µL | 필터 · 랙 | 10 | 12,900원 | 사아자 상사 | 1주 | 재고 확인 필요 |",
  "",
  "참고 주소: https://example.com/very/long/path/that/should/not/push/the/panel/wider/than/its/own/width/at/all?query=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
].join("\n")

test.beforeAll(async () => {
  const me = await prisma.user.findFirstOrThrow({ where: { name: "팀장" } })
  await prisma.user.upsert({
    where: { id: "system" },
    update: {},
    create: { id: "system", name: "Omnis", passwordHash: "!", role: "MEMBER", isActive: false, position: "시스템" },
  })
  const now = Date.now()
  const room = await prisma.chatRoom.create({
    data: {
      name: ROOM_NAME,
      kind: "OMNIS_DM",
      createdById: me.id,
      lastMessageAt: new Date(now),
      members: { create: [{ userId: me.id }] },
      messages: {
        create: [
          { authorId: me.id, content: "이번 달 시약 견적을 표로 정리해 줘", createdAt: new Date(now - 2000) },
          { authorId: "system", content: WIDE_TABLE, createdAt: new Date(now - 1000) },
        ],
      },
    },
  })
  omnisRoomId = room.id
  task = await prisma.task.findFirstOrThrow({ orderBy: { createdAt: "asc" }, select: { id: true, name: true } })
})

test.afterAll(async () => {
  if (!omnisRoomId) return
  await prisma.chatMessage.deleteMany({ where: { roomId: omnisRoomId } })
  await prisma.chatRoom.delete({ where: { id: omnisRoomId } }).catch(() => {})
  await prisma.$disconnect()
})

const panel = (page: Page) => page.locator('aside[aria-label="대화 패널"]')
const messenger = (page: Page) => panel(page).locator("[data-panel-messenger]")

async function openPanel(page: Page) {
  const dock = page.getByRole("button", { name: /^대화 패널 열기/ })
  await dock.waitFor({ timeout: 30_000 })
  await expect.poll(() => dock.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))), { timeout: 30_000 }).toBe(true)
  await dock.click()
  await expect(panel(page)).toHaveAttribute("aria-hidden", "false")
}

/** 패널 칸이 제 폭을 넘지 않는다 — 넘치면 둥근 판 밖으로 잘린다 */
async function expectNoOverflow(page: Page) {
  const sizes = await messenger(page).evaluate((el) => {
    const section = el.querySelector(":scope > section:not(.hidden)") ?? el
    return { scroll: section.scrollWidth, client: section.clientWidth }
  })
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.client + 1)
}

async function shot(page: Page, name: string) {
  if (!shots) return
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(shots, name) })
}

for (const width of [1440, 1280]) {
  test.describe(`PC ${width}`, () => {
    test.use({ viewport: { width, height: 900 } })

    test("업무 화면 옆에서 방 목록 → 방 → ← 목록 · 옴니스 대화도 목록의 방 · 넓은 표가 패널을 넘치지 않는다", async ({ page }) => {
      await login(page, "팀장")
      await page.goto("/tasks")
      await openPanel(page)

      // 목록으로 열린다 — 예전 「전체 / 옴니스」 탭(패널 보기)은 없다. 업무 상세가 아니면 탭 줄 자체가 없다
      await expect(messenger(page)).toHaveAttribute("data-panel-messenger", "list")
      await expect(panel(page).getByRole("group", { name: "패널 보기" })).toHaveCount(0)
      const row = panel(page).locator(`a[href$="/chat/${omnisRoomId}"]`)
      await expect(row).toBeVisible({ timeout: 30_000 })
      await expectNoOverflow(page)
      await shot(page, `pc-${width}-1-list.png`)

      // 옴니스 대화 — 본문 주소는 그대로
      await row.click()
      await expect(messenger(page)).toHaveAttribute("data-panel-messenger", "room")
      // 답의 표는 복사할 수 있는 표(CopyableSheet)로 그린다 — 넘침은 그 상자 안에서 가로로 민다(#199)
      const answer = panel(page).locator("[data-copyable-sheet]").filter({ visible: true }).first()
      await expect(answer).toBeVisible({ timeout: 30_000 })
      expect(new URL(page.url()).pathname).toBe("/tasks")
      await expectNoOverflow(page)
      // 표는 표 안에서 민다 — 표 칸의 바깥 폭은 패널 칸을 넘지 않고, 안쪽이 더 넓으면 가로 스크롤이 생긴다
      const table = await answer.evaluate((el) => ({ box: el.getBoundingClientRect().width, scroll: el.scrollWidth, overflow: getComputedStyle(el).overflowX }))
      const room = await messenger(page).evaluate((el) => el.getBoundingClientRect().width)
      expect(table.box).toBeLessThanOrEqual(room)
      expect(table.overflow).toBe("auto")
      await shot(page, `pc-${width}-2-omnis-table.png`)

      // ← 목록
      await panel(page).getByRole("button", { name: "채팅방 목록으로" }).filter({ visible: true }).click()
      await expect(messenger(page)).toHaveAttribute("data-panel-messenger", "list")

      // 전사방
      await panel(page).locator('a[href$="/chat/default-room"]').first().click()
      await expect(panel(page).getByPlaceholder("메시지 입력...  / 명령 · @ 사람 · # 업무")).toBeVisible({ timeout: 30_000 })
      await expectNoOverflow(page)
      await shot(page, `pc-${width}-3-company.png`)

      // 새 옴니스 대화 — 패널 안에서
      await panel(page).getByRole("button", { name: "채팅방 목록으로" }).filter({ visible: true }).click()
      await panel(page).getByRole("button", { name: "새 대화" }).click()
      await page.getByRole("menuitem", { name: /옴니스와 대화/ }).click()
      await expect(panel(page).locator("[data-room-header]").filter({ visible: true })).toContainText("새 대화")
      expect(new URL(page.url()).pathname).toBe("/tasks")
      await shot(page, `pc-${width}-4-new-omnis.png`)
    })
  })
}

test.describe("PC 1440 — 채팅 탭으로 넘기기", () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test("패널에서 보던 방이 nav 「채팅」 으로 본문에 열리고 패널은 닫힌다 · 다시 열면 그 방", async ({ page }) => {
    await login(page, "팀장")
    await page.goto("/calendar")
    await openPanel(page)
    await panel(page).locator(`a[href$="/chat/${omnisRoomId}"]`).click()
    await expect(panel(page).locator("[data-copyable-sheet]").filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 })

    await page.locator('nav[aria-label="주 메뉴"]').filter({ visible: true }).getByRole("link", { name: "채팅" }).click()
    await page.waitForURL(`**/chat/${omnisRoomId}`, { timeout: 30_000 })
    await expect(panel(page)).toHaveAttribute("aria-hidden", "true")
    await expect(page.locator("[data-messenger] [data-copyable-sheet]").filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 })
    await shot(page, "pc-1440-5-handoff.png")

    // 다른 탭으로 가서 패널을 다시 열면 그 방 그대로
    await page.goto("/tasks")
    await openPanel(page)
    await expect(messenger(page)).toHaveAttribute("data-panel-messenger", "room")
    await expect(panel(page).locator("[data-room-header]").filter({ visible: true })).toContainText(ROOM_NAME)
  })

  test("패널이 닫혀 있으면 nav 「채팅」 은 지금처럼 목록", async ({ page }) => {
    await login(page, "팀장")
    await page.goto("/calendar")
    await page.locator('nav[aria-label="주 메뉴"]').filter({ visible: true }).getByRole("link", { name: "채팅" }).click()
    await page.waitForURL((u) => u.pathname === "/chat", { timeout: 30_000 })
  })

  test("?taskId= 링크는 패널의 그 업무방으로", async ({ page }) => {
    await login(page, "팀장")
    await page.goto(`/calendar?taskId=${task.id}`)
    await expect(panel(page)).toHaveAttribute("aria-hidden", "false", { timeout: 30_000 })
    await expect(panel(page).locator("[data-room-header]").filter({ visible: true })).toContainText(task.name, { timeout: 30_000 })
    expect(new URL(page.url()).pathname).toBe("/calendar")
    await expectNoOverflow(page)
    await shot(page, "pc-1440-6-task-room.png")
  })
})

test.describe("폰", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test("폰 채팅 탭은 그대로 — 같은 목록 · 같은 방(패널은 없다)", async ({ page }) => {
    await login(page, "팀장")
    await expect(page.locator(`a[href$="/chat/${omnisRoomId}"]`).filter({ visible: true })).toBeVisible({ timeout: 30_000 })
    await expect(panel(page)).toBeHidden()
    await shot(page, "phone-1-list.png")
    await page.locator(`a[href$="/chat/${omnisRoomId}"]`).filter({ visible: true }).tap()
    await expect(page.locator("[data-copyable-sheet]").filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await shot(page, "phone-2-omnis-table.png")
  })
})
