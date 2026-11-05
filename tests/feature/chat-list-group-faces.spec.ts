/**
 * 단톡방 목록 줄 — 참여자 둘을 겹친 사진과 회색 인원 수. 방을 시험 DB 에 직접 넣는다 — 로컬 DB(CI · e2e-local)에서만 돈다.
 */
import { randomUUID } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { login } from "./_setup"

const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")
test.skip(!LOCAL_DB, "시험 DB 를 직접 고친다")
test.describe.configure({ mode: "serial" })

const prisma = LOCAL_DB ? new PrismaClient() : (null as unknown as PrismaClient)
const wide = randomUUID()
const lone = randomUUID()
const hiddenFromMe = randomUUID()
const LONG_NAME = "이름이 아주 길어서 목록 한 줄에 다 들어가지 않는 단톡방 시험"

test.beforeAll(async () => {
  const [me, a, b, c] = await Promise.all(
    ["팀장", "사원1", "사원2", "사원3"].map((name) => prisma.user.findFirstOrThrow({ where: { name } })),
  )
  const at = new Date()
  const room = (id: string, name: string, ids: string[], createdById = me.id) =>
    prisma.chatRoom.create({
      data: { id, name, kind: "GROUP", createdById, createdAt: at, lastMessageAt: at, members: { create: ids.map((userId, i) => ({ userId, joinedAt: new Date(at.getTime() + i) })) } },
    })
  await room(wide, LONG_NAME, [me.id, a.id, b.id, c.id])
  await room(lone, "한 명 남은 방 시험", [me.id, a.id])
  await room(hiddenFromMe, "내가 없는 방 시험", [a.id, b.id], a.id)
})

test.afterAll(async () => {
  await prisma?.chatRoom.deleteMany({ where: { id: { in: [wide, lone, hiddenFromMe] } } })
  await prisma?.$disconnect()
})

const row = (id: string) => `aside a[href="/chat/${id}"]`

async function openList(page: Page) {
  await login(page, "팀장")
  await page.goto("/chat")
  await page.locator(row(wide)).waitFor({ state: "attached", timeout: 30_000 })
}

/** 겹친 사진 둘의 자리 · 인원 수가 줄 안에 온전히 보이는가 */
async function checkFaces(page: Page, box: number) {
  const g = await page.locator(row(wide)).evaluate((el) => {
    const frame = el.querySelector("[data-group-faces]")!
    const [a, b] = [...frame.children].map((c) => c.getBoundingClientRect())
    const count = el.querySelector("[data-member-count]")!
    const f = frame.getBoundingClientRect()
    const c = count.getBoundingClientRect()
    return {
      frame: f.width,
      faces: frame.children.length,
      overlapX: a.right - b.left,
      overlapY: a.bottom - b.top,
      text: count.textContent,
      color: getComputedStyle(count).color,
      nameColor: getComputedStyle(count.previousElementSibling!).color,
      countInRow: c.right <= el.getBoundingClientRect().right && c.width > 0,
      faceTexts: [...frame.children].map((x) => x.textContent),
    }
  })
  expect(g.frame).toBe(box)
  expect(g.faces).toBe(2)
  expect(g.overlapX).toBeGreaterThan(0)
  expect(g.overlapY).toBeGreaterThan(0)
  expect(g.text).toBe("4")
  expect(g.color).not.toBe(g.nameColor)
  expect(g.countInRow).toBe(true)
  expect(g.faceTexts.every((t) => !t?.includes("팀장"))).toBe(true)
}

for (const dark of [false, true]) {
  const label = dark ? "다크" : "라이트"
  test.describe(`폰 ${label}`, () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: dark ? "dark" : "light" })

    test("긴 이름은 줄고 인원 수는 남으며, 사진은 둘이 겹친다", async ({ page }) => {
      await openList(page)
      await checkFaces(page, 47)
      await expect(page.locator(row(wide)).locator("[data-member-count]")).toHaveAttribute("aria-label", "참여자 4명")
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    })
  })
}

test.describe("PC", () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test("같은 줄 모양이고, 한 명 남은 방은 사진 하나이며, 내가 없는 방은 오지 않는다", async ({ page }) => {
    await openList(page)
    await checkFaces(page, await page.locator(row(wide)).locator("[data-group-faces]").evaluate((el) => el.getBoundingClientRect().width))
    await expect(page.locator(row(lone)).locator("[data-group-faces]")).toHaveCount(0)
    await expect(page.locator(row(lone)).locator("[data-member-count]")).toHaveText("2")
    await expect(page.locator(row(hiddenFromMe))).toHaveCount(0)

    // 응답에는 이름 둘과 수만 — 참여자 전체 · id 를 내리지 않는다
    const body = await page.evaluate(() => fetch("/api/chat/rooms").then((r) => r.json()))
    const item = body.groups.find((r: { id: string }) => r.id === wide)
    expect(item.memberCount).toBe(4)
    expect(item.faceNames).toEqual(["사원1", "사원2"])
    expect(item.members).toBeUndefined()
    expect(body.groups.some((r: { id: string }) => r.id === hiddenFromMe)).toBe(false)
    // 다른 종류의 방은 필드가 없다
    expect(body.company[0].memberCount).toBeUndefined()
  })
})
