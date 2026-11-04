/**
 * 담당자 후보는 재직자만 — 이미 담당인 퇴사자는 이름과 데이터가 그대로다.
 * 계획: mydocs/plans/2026-11-04-active-assignees.md
 *
 *   pnpm run test:e2e:local tests/feature/active-assignees.spec.ts
 *
 * 퇴사자를 DB 에 직접 넣는다 — 격리된 시험 DB(E2E_ISOLATED, scripts/e2e-local.mjs)에서만 돈다. CI 에서는 건너뛴다.
 * 재직자 쪽(인력 표 없는 계정이 빠지지 않는다)은 어디서나 돈다.
 */
import { expect, test, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { login } from "./_setup"

const DEMO_NAMES = ["팀장", "부팀장", "사원1", "사원2", "사원3"]

test("인력 표가 없는 재직 계정은 후보에서 빠지지 않는다", async ({ page }) => {
  await login(page, "팀장")
  const users = (await (await page.request.get("/api/users")).json()) as { name: string }[]
  expect(users.map((u) => u.name)).toEqual(expect.arrayContaining(DEMO_NAMES))
})

test.describe("격리된 시험 DB 에서만", () => {
  test.skip(process.env.E2E_ISOLATED !== "true", "퇴사자를 DB 에 직접 넣는다")
  test.describe.configure({ mode: "serial" })

  const stamp = Date.now()
  const offName = `계정꺼짐${stamp}` // isActive=false, 인력 표 없음
  const formerName = `인력퇴사${stamp}` // 계정은 살아 있고 인력 표가 퇴사
  const prisma = new PrismaClient()
  let off: string, former: string, manager: string, member1: string, member2: string
  let withFormer: string, plain: string, unassigned: string, group: string

  test.beforeAll(async () => {
    const id = async (name: string) => (await prisma.user.findFirstOrThrow({ where: { name }, select: { id: true } })).id
    manager = await id("팀장")
    member1 = await id("사원1")
    member2 = await id("사원2")
    off = (await prisma.user.create({ data: { name: offName, isActive: false, passwordHash: "x" } })).id
    former = (await prisma.user.create({
      data: { name: formerName, passwordHash: "x", staffProfile: { create: { name: formerName, affiliation: "시험", employment: "FORMER" } } },
    })).id
    const task = (name: string, slug: string, assignees: string[]) =>
      prisma.task.create({ data: { name, slug, instructorId: manager, assignees: { create: assignees.map((userId) => ({ userId })) } } })
    withFormer = (await task(`퇴사자담당 ${stamp}`, `former-${stamp}`, [off, member1])).id
    plain = (await task(`재직자담당 ${stamp}`, `plain-${stamp}`, [member1])).id
    unassigned = (await task(`미배정 ${stamp}`, `none-${stamp}`, [])).id
    group = (await prisma.chatRoom.create({
      data: { name: `퇴사자방 ${stamp}`, kind: "GROUP", createdById: manager, members: { create: [{ userId: manager }, { userId: member1 }, { userId: off }] } },
    })).id
  })

  test.afterAll(async () => {
    // 표를 비우지 않고 보이지 않게만 — 다른 시험의 집계에 끼지 않는다. DB 는 러너가 통째로 지운다
    await prisma.task.updateMany({ where: { id: { in: [withFormer, plain, unassigned] } }, data: { archived: true } })
    await prisma.$disconnect()
  })

  const patch = (page: Page, id: string, data: unknown) => page.request.patch(`/api/tasks/${id}`, { data })
  const assigneesOf = async (taskId: string) =>
    (await prisma.taskAssignee.findMany({ where: { taskId }, select: { userId: true } })).map((a) => a.userId).sort()

  test("구성원 목록에 퇴사자 둘 다 없다", async ({ page }) => {
    await login(page, "팀장")
    const names = ((await (await page.request.get("/api/users")).json()) as { name: string }[]).map((u) => u.name)
    expect(names).not.toContain(offName)
    expect(names).not.toContain(formerName)
  })

  test("거부 — 새 업무에 퇴사자를 담당으로 넣을 수 없다(id · 이름)", async ({ page }) => {
    await login(page, "팀장")
    const before = await prisma.task.count()
    const post = (data: object) => page.request.post("/api/tasks", { data: { name: `거부 ${stamp}`, ...data } })
    expect((await post({ ownerIds: [off] })).status()).toBe(400)
    expect((await post({ ownerIds: [member1, former] })).status()).toBe(400)
    expect((await post({ ownerNames: [offName] })).status()).toBe(400)
    expect((await post({ ownerNames: [formerName] })).status()).toBe(400)
    expect(await prisma.task.count()).toBe(before)
  })

  test("거부 — 기존 업무에 퇴사자를 새로 담당 · 지시자로 넣을 수 없다", async ({ page }) => {
    await login(page, "팀장")
    expect((await patch(page, plain, { assigneeIds: [member1, off] })).status()).toBe(400)
    expect((await patch(page, plain, { assigneeIds: [former] })).status()).toBe(400)
    expect((await patch(page, plain, { instructorId: off })).status()).toBe(400)
    expect((await patch(page, plain, { instructorId: former })).status()).toBe(400)
    expect(await assigneesOf(plain)).toEqual([member1])
  })

  test("이미 담당인 퇴사자를 남긴 채 다른 사람을 더할 수 있고 빼면 다시 못 넣는다", async ({ page }) => {
    await login(page, "팀장")
    const res = await patch(page, withFormer, { assigneeIds: [off, member1, member2], instructorId: manager })
    expect(res.status()).toBe(200)
    expect(await assigneesOf(withFormer)).toEqual([off, member1, member2].sort())

    // 뺀 뒤에는 이미 담당이 아니므로 새로 고르는 것이다 — 막힌다
    const other = await prisma.task.create({
      data: { name: `뺐다넣기 ${stamp}`, slug: `readd-${stamp}`, instructorId: manager, archived: true, assignees: { create: [{ userId: off }, { userId: member1 }] } },
    })
    expect((await patch(page, other.id, { assigneeIds: [member1] })).status()).toBe(200)
    expect((await patch(page, other.id, { assigneeIds: [member1, off] })).status()).toBe(400)
  })

  test("업무 화면 — 퇴사자 이름이 그대로 보이고, 편집 칩은 그 업무에 걸린 사람만 표시를 달아 남긴다", async ({ page }) => {
    await login(page, "팀장")
    await page.goto(`/tasks/${withFormer}`)
    await expect(page.getByText(offName).first()).toBeVisible({ timeout: 30_000 })
    await page.getByRole("button", { name: "담당자·지시자 편집" }).click()
    const chip = page.getByRole("button", { name: `${offName} · 과거 구성원` })
    await expect(chip).toHaveAttribute("aria-pressed", "true")
    await expect(page.getByRole("button", { name: formerName })).toHaveCount(0)
    // 손대지 않고 저장해도 빠지지 않는다
    await page.getByRole("button", { name: "저장", exact: true }).click()
    await expect(page.getByRole("button", { name: "담당자·지시자 편집" })).toBeVisible()
    expect(await assigneesOf(withFormer)).toContain(off)
    await expect(page.getByText(offName).first()).toBeVisible()

    await page.goto(`/tasks/${plain}`)
    await page.getByRole("button", { name: "담당자·지시자 편집" }).click()
    await expect(page.getByRole("button", { name: "사원2", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: new RegExp(offName) })).toHaveCount(0)
    await expect(page.getByRole("button", { name: new RegExp(formerName) })).toHaveCount(0)
  })

  test("업무 목록 — 담당 칩 · 담당 지정에는 없고, 검색칸으로는 과거 담당 업무를 찾는다", async ({ page }) => {
    await login(page, "팀장")
    await page.goto("/tasks")
    await expect(page.locator(`a[href="/tasks?assignee=${member1}"]`).first()).toBeVisible({ timeout: 30_000 })
    await expect(page.locator(`a[href*="assignee=${off}"]`)).toHaveCount(0)

    // 기본은 보드다 — 검색칸과 「담당 지정」 은 목록 보기에 있다
    await page.getByRole("button", { name: "목록" }).click()
    const search = page.getByPlaceholder("업무명 / 담당자 / 제품 검색")
    await search.fill(`미배정 ${stamp}`)
    await page.getByRole("button", { name: `미배정 ${stamp} 담당 지정` }).click()
    await expect(page.getByRole("menuitem", { name: "사원1", exact: true })).toBeVisible()
    await expect(page.getByRole("menuitem", { name: offName })).toHaveCount(0)
    await expect(page.getByRole("menuitem", { name: formerName })).toHaveCount(0)
    await page.keyboard.press("Escape")

    // 담당이 넷이면 카드 이름은 「외 1명」 으로 접힌다 — 넷째 자리 퇴사자도 검색으로 찾는다
    await prisma.taskAssignee.deleteMany({ where: { taskId: withFormer } })
    await prisma.taskAssignee.createMany({
      data: [member1, member2, manager, off].map((userId) => ({ taskId: withFormer, userId })),
    })
    await page.reload()
    await search.fill(offName)
    await expect(page.getByText(`퇴사자담당 ${stamp}`).first()).toBeVisible()
  })

  test("사람 방 — 떠난 사람은 참여자 수에 남고 @ 후보에는 없다", async ({ page }) => {
    await login(page, "팀장")
    await page.goto(`/chat/${group}`)
    await expect(page.getByRole("button", { name: "참여자 3명" })).toBeVisible({ timeout: 30_000 })
    const box = page.locator("textarea").first()
    await box.fill("@")
    await box.press("End")
    const popup = page.locator("[data-composer-autocomplete]")
    await expect(popup.getByText("사원1")).toBeVisible()
    await expect(popup.getByText(offName)).toHaveCount(0)
  })
})
