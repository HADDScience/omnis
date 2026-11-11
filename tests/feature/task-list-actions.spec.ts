/**
 * 업무 목록 · 보드에서 바로 — 담당 없는 업무의 「담당 지정」 칩(PC 팝오버 · 폰 바텀시트)과 모든 업무의 「Omnis 와 시작」 아이콘.
 * 담당 지정은 업무 상세 칸(quick-assign.spec.ts)과 같은 PATCH, Omnis 시작은 상세 단추(task-start-omnis.spec.ts)와 같은 일회용 키.
 *
 *   pnpm run test:e2e:local tests/feature/task-list-actions.spec.ts
 *
 * 담당 없는 업무를 DB 에 직접 넣는다 — 격리된 시험 DB(E2E_ISOLATED)에서만 돈다. 끝나면 보관한다.
 * 옴니스 실행은 돌리지 않는다 — 보내는 요청을 받아 적고 429 로 돌려준다.
 * TASK_LIST_SHOTS 에 절대 경로를 주면 PC · 폰 화면을 그 폴더에 남긴다(데모 시드 계정만 보인다).
 */
import path from "node:path"
import { expect, test, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { chooseAssignees } from "./_actions"
import { login } from "./_setup"

test.skip(process.env.E2E_ISOLATED !== "true", "담당 없는 업무를 DB 에 직접 넣는다")

const shots = process.env.TASK_LIST_SHOTS
const stamp = Date.now()
const made: string[] = []
const prisma = new PrismaClient()

async function unassignedTask(label: string): Promise<{ id: string; name: string; slug: string }> {
  const instructor = await prisma.user.findFirstOrThrow({ where: { name: "팀장" }, select: { id: true } })
  const task = await prisma.task.create({
    data: {
      name: `목록시험 ${label} ${stamp}`,
      slug: `list-${made.length}-${stamp}`,
      instructorId: instructor.id,
      checklists: { create: [{ name: `목록시험 시료 받기 ${stamp}` }] },
    },
    select: { id: true, name: true, slug: true },
  })
  made.push(task.id)
  return task
}

const assigneeNames = async (id: string) =>
  (await prisma.taskAssignee.findMany({ where: { taskId: id }, select: { user: { select: { name: true } } } })).map((a) => a.user.name)

test.afterAll(async () => {
  await prisma.task.updateMany({ where: { id: { in: made } }, data: { archived: true } })
  await prisma.$disconnect()
})

async function prepare(page: Page, view: "list" | "board") {
  await page.addInitScript((v) => {
    localStorage.setItem("omnis:nudge-off:install", "1")
    localStorage.setItem("omnis:nudge-off:push", "1")
    localStorage.setItem("omnis:tasks-view", v)
  }, view)
}

/** 옴니스에 보낸 글을 받아 적는다. 실행은 돌리지 않고 429 로 돌려준다 */
async function recordAsks(page: Page) {
  const asked: string[] = []
  await page.route("**/api/agent/rooms**", async (route) => {
    if (route.request().method() !== "POST") return route.continue()
    asked.push((JSON.parse(route.request().postData() ?? "{}") as { content?: string }).content ?? "")
    return route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "시험 — 실행하지 않음" }) })
  })
  return asked
}

const row = (page: Page, id: string) => page.locator(`[data-task-row="${id}"]`)
const confirmBox = (page: Page) => page.locator("[data-start-with-omnis-confirm]")

async function openList(page: Page, name: string) {
  await page.goto("/tasks")
  await page.getByPlaceholder("업무명 / 담당자 / 제품 검색").fill(name)
}

test.describe("PC", () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  // 지키는 것: 목록에서 상세로 가지 않고 담당을 여러 명 지정 · 해제할 수 있다
  test("목록 — 담당 지정 칩 → 팝오버에서 두 명 지정, 다시 열어 한 명 해제 · 상세로 넘어가지 않는다", async ({ page }) => {
    const task = await unassignedTask("PC지정")
    await prepare(page, "list")
    await login(page, "팀장")
    await openList(page, task.name)
    const chip = row(page, task.id).locator(`[data-quick-assign-chip="${task.id}"]`)
    await expect(chip).toBeVisible()
    // 칩이 「미배정」 표를 대신한다
    await expect(row(page, task.id)).not.toContainText("미배정")
    await chip.click()
    const pop = page.locator(`[data-quick-assign-pop="${task.id}"]`)
    await expect(pop).toBeVisible()
    if (shots) {
      await page.waitForTimeout(400)
      await page.screenshot({ path: path.join(shots, "pc-1-list-assign.png") })
    }
    await chooseAssignees(pop, ["사원1", "사원2"])
    // 저장을 기다리지 않고 바로 바뀐다 — 칩 자리에 겹친 아바타(같은 단추)
    await expect(chip).not.toContainText("담당 지정")
    await expect(row(page, task.id).locator("[data-assignee-stack]")).toHaveAttribute("data-assignee-stack", "2")
    expect(new URL(page.url()).pathname).toBe("/tasks")
    await expect.poll(async () => (await assigneeNames(task.id)).sort()).toEqual(["사원1", "사원2"])

    // 다시 열면 지금 담당이 골라져 있고, 한 명을 빼서 저장한다
    await chip.click()
    await expect(pop.getByRole("button", { name: "사원1", exact: true })).toHaveAttribute("aria-pressed", "true")
    await expect(pop.getByRole("button", { name: "사원2", exact: true })).toHaveAttribute("aria-pressed", "true")
    // 바꾸지 않으면 저장할 수 없다
    await expect(pop.locator("[data-quick-assign-save]")).toBeDisabled()
    if (shots) await page.screenshot({ path: path.join(shots, "pc-1b-list-reassign.png") })
    await chooseAssignees(pop, ["사원1"])
    await expect(row(page, task.id).locator("[data-assignee-stack]")).toHaveAttribute("data-assignee-stack", "1")
    await expect.poll(() => assigneeNames(task.id)).toEqual(["사원2"])
  })

  // 지키는 것: 저장이 실패하면 목록이 지정된 척하지 않는다
  test("목록 — 저장이 실패하면 칩이 돌아온다", async ({ page }) => {
    const task = await unassignedTask("PC실패")
    await prepare(page, "list")
    await page.route(`**/api/tasks/${task.id}`, (route) =>
      route.request().method() === "PATCH" ? route.fulfill({ status: 500, body: "{}" }) : route.continue(),
    )
    await login(page, "팀장")
    await openList(page, task.name)
    await row(page, task.id).locator(`[data-quick-assign-chip="${task.id}"]`).click()
    await chooseAssignees(page.locator(`[data-quick-assign-pop="${task.id}"]`), ["사원1"])
    await expect(page.getByText("지정하지 못했습니다 (500)")).toBeVisible()
    await expect(row(page, task.id).locator(`[data-quick-assign-chip="${task.id}"]`)).toContainText("담당 지정")
    expect(await assigneeNames(task.id)).toEqual([])
  })

  test("보드 — Omnis 아이콘 → 확인 → 업무 화면에 남은 채 패널 옴니스 새 대화에 첫 글이 한 번", async ({ page }) => {
    const task = await unassignedTask("PC옴니스")
    await prepare(page, "board")
    const asked = await recordAsks(page)
    await login(page, "팀장")
    await page.goto("/tasks")
    const icon = page.locator(`[data-start-with-omnis-icon="${task.id}"]`)
    await expect(icon).toBeVisible()
    await icon.click()
    await expect(confirmBox(page)).toContainText(task.name)
    await expect(confirmBox(page).getByRole("button", { name: "시작하기" })).toBeEnabled()
    if (shots) await page.screenshot({ path: path.join(shots, "pc-2-board-confirm.png") })
    await confirmBox(page).getByRole("button", { name: "시작하기" }).dblclick()
    await expect(confirmBox(page)).toHaveCount(0)
    const panel = page.getByRole("complementary", { name: "대화 패널" })
    await expect(panel.getByRole("button", { name: "옴니스", exact: true })).toHaveAttribute("aria-pressed", "true")
    await expect.poll(() => asked.length, { timeout: 15_000 }).toBe(1)
    expect(asked[0].split("\n")[0]).toBe(`#${task.slug} 「${task.name}」 업무를 지금부터 함께 진행하자. 먼저 남은 체크리스트를 기준으로 다음 할 일을 제안해 줘.`)
    expect(asked[0]).toContain(`  - 목록시험 시료 받기 ${stamp}`)
    expect(new URL(page.url()).pathname).toBe("/tasks")
    if (shots) await page.screenshot({ path: path.join(shots, "pc-3-board-sent.png") })
    await page.waitForTimeout(800)
    expect(asked).toHaveLength(1)
  })
})

test.describe("폰", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test("목록 — 칩 → 바텀시트에서 지정, Omnis 아이콘은 44px · 옴니스 새 대화로 가서 한 번 보낸다", async ({ page }) => {
    const task = await unassignedTask("폰")
    await prepare(page, "list")
    const asked = await recordAsks(page)
    await login(page, "팀장")
    await openList(page, task.name)
    const icon = row(page, task.id).locator(`[data-start-with-omnis-icon="${task.id}"]`)
    const box = (await icon.boundingBox())!
    expect(box.width).toBeGreaterThanOrEqual(44)
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    if (shots) await page.screenshot({ path: path.join(shots, "phone-1-list.png") })

    await row(page, task.id).locator(`[data-quick-assign-chip="${task.id}"]`).tap()
    const sheet = page.locator(`[data-quick-assign-sheet="${task.id}"]`)
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText(task.name)
    if (shots) {
      // 시트가 올라오는 동안 찍지 않게
      await page.waitForTimeout(600)
      await page.screenshot({ path: path.join(shots, "phone-2-assign-sheet.png") })
    }
    await chooseAssignees(sheet, ["사원1"], { tap: true })
    await expect(sheet).toHaveCount(0)
    await expect(row(page, task.id).locator(`[data-quick-assign-chip="${task.id}"]`)).not.toContainText("담당 지정")
    expect(new URL(page.url()).pathname).toBe("/tasks")
    await expect.poll(() => assigneeNames(task.id)).toEqual(["사원1"])

    await icon.tap()
    await expect(confirmBox(page)).toContainText(task.name)
    if (shots) await page.screenshot({ path: path.join(shots, "phone-3-confirm.png") })
    await confirmBox(page).getByRole("button", { name: "시작하기" }).tap()
    await page.waitForURL(/\/chat\/new\?start=/)
    await expect.poll(() => asked.length, { timeout: 15_000 }).toBe(1)
    expect(asked[0]).toContain(`- 업무: #${task.slug} (ID ${task.id})`)
    if (shots) await page.screenshot({ path: path.join(shots, "phone-4-sent.png") })
    await page.goBack()
    await page.waitForURL("**/tasks")
    await page.waitForTimeout(1_000)
    expect(asked).toHaveLength(1)
  })

  test("보드 — 카드 안 아이콘을 눌러도 끌리거나 상세로 가지 않고 확인 창만 뜬다", async ({ page }) => {
    const task = await unassignedTask("폰보드")
    await prepare(page, "board")
    await login(page, "팀장")
    await page.goto("/tasks")
    const icon = page.locator(`[data-start-with-omnis-icon="${task.id}"]`)
    await expect(icon).toBeVisible()
    if (shots) await page.screenshot({ path: path.join(shots, "phone-5-board.png") })
    await icon.tap()
    await expect(confirmBox(page)).toBeVisible()
    await confirmBox(page).getByRole("button", { name: "취소" }).tap()
    await expect(confirmBox(page)).toHaveCount(0)
    expect(new URL(page.url()).pathname).toBe("/tasks")
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id }, select: { status: true } })).status).toBe("TODO")
    // 담당 지정 칩도 카드 안에서 바텀시트를 연다
    await page.locator(`[data-quick-assign-chip="${task.id}"]`).tap()
    await expect(page.locator(`[data-quick-assign-sheet="${task.id}"]`)).toBeVisible()
  })
})
