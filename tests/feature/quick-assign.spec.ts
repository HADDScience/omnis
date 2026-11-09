/**
 * 미배정 업무 상세의 「담당자 지정」 칸 — 한 번 눌러 지정 · 실패하면 되돌림 · 폰에서 44px.
 * 계획: mydocs/plans/2026-11-09-quick-assign.md
 *
 *   pnpm run test:e2e:local tests/feature/quick-assign.spec.ts
 *
 * API 는 담당 없는 업무를 만들지 않는다(최소 1명) — 미배정 업무는 이식 · AI 정리에서 생긴다. 그래서 DB 에 직접 넣고,
 * 격리된 시험 DB(E2E_ISOLATED, scripts/e2e-local.mjs)에서만 돈다. 끝나면 보관한다.
 * QUICK_ASSIGN_SHOTS 에 절대 경로를 주면 PC · 폰 화면을 그 폴더에 남긴다(데모 시드 계정만 보인다).
 */
import path from "node:path"
import { expect, test, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { login } from "./_setup"

test.skip(process.env.E2E_ISOLATED !== "true", "담당 없는 업무를 DB 에 직접 넣는다")

const shots = process.env.QUICK_ASSIGN_SHOTS
const stamp = Date.now()
const made: string[] = []

const prisma = new PrismaClient()

async function unassignedTask(label: string): Promise<string> {
  const instructor = await prisma.user.findFirstOrThrow({ where: { name: "팀장" }, select: { id: true } })
  const { id } = await prisma.task.create({
    data: { name: `미배정 시험 ${label} ${stamp}`, slug: `quick-${made.length}-${stamp}`, instructorId: instructor.id },
    select: { id: true },
  })
  made.push(id)
  return id
}

const assigneeNames = async (page: Page, id: string) =>
  ((await (await page.request.get(`/api/tasks/${id}`)).json()) as { assignees: { user: { name: string } }[] }).assignees.map(
    (a) => a.user.name,
  )

test.afterAll(async () => {
  // 표를 비우지 않고 보이지 않게만 — DB 는 러너가 통째로 지운다
  await prisma.task.updateMany({ where: { id: { in: made } }, data: { archived: true } })
  await prisma.$disconnect()
})

test("PC — 칩을 한 번 누르면 담당이 되고 칸이 사라진다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page, "팀장")
  const id = await unassignedTask("PC")
  await page.goto(`/tasks/${id}`)

  const box = page.locator("[data-quick-assign]")
  await expect(box).toBeVisible({ timeout: 30_000 })
  await expect(box.getByRole("button", { name: "사원1님을 담당으로 지정" })).toBeVisible()
  if (shots) await page.screenshot({ path: path.join(shots, "quick-assign-pc.png") })

  await box.getByRole("button", { name: "사원1님을 담당으로 지정" }).click()
  await expect(box).toHaveCount(0)
  await expect(page.getByText("사원1", { exact: true }).first()).toBeVisible()
  await expect.poll(() => assigneeNames(page, id)).toEqual(["사원1"])

  // 새로 열어도 칸이 없다 — 저장된 값으로 그린다
  await page.reload()
  await expect(page.getByRole("heading", { name: `미배정 시험 PC ${stamp}` })).toBeVisible({ timeout: 30_000 })
  await expect(page.locator("[data-quick-assign]")).toHaveCount(0)
})

test("저장이 실패하면 칸이 되돌아오고 담당은 비어 있다", async ({ page }) => {
  await login(page, "팀장")
  const id = await unassignedTask("실패")
  await page.route(`**/api/tasks/${id}`, (route) =>
    route.request().method() === "PATCH" ? route.fulfill({ status: 500, body: "{}" }) : route.fallback(),
  )
  await page.goto(`/tasks/${id}`)
  const box = page.locator("[data-quick-assign]")
  await expect(box).toBeVisible({ timeout: 30_000 })
  await box.getByRole("button", { name: "사원2님을 담당으로 지정" }).click()
  await expect(page.getByText("지정하지 못했습니다 (500)")).toBeVisible()
  await expect(box).toBeVisible()
  expect(await assigneeNames(page, id)).toEqual([])
})

test("폰 — 칩은 엄지 크기(44px 이상)이고 눌러서 지정된다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page, "팀장")
  const id = await unassignedTask("폰")
  await page.goto(`/tasks/${id}`)

  const box = page.locator("[data-quick-assign]")
  await expect(box).toBeVisible({ timeout: 30_000 })
  const chips = box.locator("[data-quick-assign-person]")
  expect(await chips.count()).toBeGreaterThan(0)
  for (const h of await chips.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) {
    expect(h).toBeGreaterThanOrEqual(44)
  }
  if (shots) await page.screenshot({ path: path.join(shots, "quick-assign-mobile.png") })

  await box.getByRole("button", { name: "사원3님을 담당으로 지정" }).click()
  await expect(box).toHaveCount(0)
  await expect.poll(() => assigneeNames(page, id)).toEqual(["사원3"])
})

test("완료된 업무에는 칸이 없다", async ({ page }) => {
  await login(page, "팀장")
  const id = await unassignedTask("완료")
  expect((await page.request.patch(`/api/tasks/${id}`, { data: { status: "DONE" } })).ok()).toBeTruthy()
  await page.goto(`/tasks/${id}`)
  await expect(page.getByRole("heading", { name: `미배정 시험 완료 ${stamp}` })).toBeVisible({ timeout: 30_000 })
  await expect(page.locator("[data-quick-assign]")).toHaveCount(0)
})
