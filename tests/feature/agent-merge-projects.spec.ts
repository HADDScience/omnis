/**
 * 앱 AI(옴니스 대화방)로 프로젝트 합치기(#248) — merge_projects 가 확인 카드(업무 수 전 → 뒤 · 보관)를 띄우고,
 * 확인하면 화면 API 와 같은 서버 함수(lib/project-merge.ts)로 업무가 옮겨지고 원본이 보관된다.
 * 시험 모델(OMNIS_AGENT_FAKE=1)이 글 속 [[도구 {입력}]] 대로 도구를 부른다. 프로젝트 이름은 지어낸 것이다.
 */
import { expect, test, type Locator, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { quickLogin } from "./_setup"

const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")
const stamp = Date.now()

const box = (page: Page) => page.locator("[data-composer-pill] textarea").first()
const reactReady = (el: Locator) =>
  expect.poll(() => el.evaluate((n) => Object.keys(n).some((k) => k.startsWith("__reactProps"))), { timeout: 30_000 }).toBe(true)

test.use({ viewport: { width: 1280, height: 860 } })

test("앱 AI — 프로젝트 합치기는 확인 카드에 업무 수 전 → 뒤가 보이고, 확인하면 업무가 옮겨지고 원본이 보관된다", async ({ page }) => {
  test.skip(!LOCAL_DB, "시험 DB 를 직접 쓰고 읽는다")
  test.setTimeout(120_000)
  const prisma = new PrismaClient()
  const source = await prisma.project.create({ data: { name: `시험합칠과제${stamp}`, status: "진행 중" } })
  const target = await prisma.project.create({ data: { name: `시험남을과제${stamp}`, status: "진행 중" } })
  const instructor = await prisma.user.findFirstOrThrow({ where: { name: "사원1" }, select: { id: true } })
  const tasks = await Promise.all([1, 2].map((i) =>
    prisma.task.create({ data: { name: `시험합칠업무${stamp}-${i}`, slug: `merge-e2e-${stamp}-${i}`, instructorId: instructor.id, projectId: source.id } }),
  ))
  try {
    await page.addInitScript(() => {
      localStorage.setItem("omnis:nudge-off:install", "1")
      localStorage.setItem("omnis:nudge-off:push", "1")
    })
    await quickLogin(page, "사원1")
    await page.goto("/chat/new")
    await box(page).waitFor({ timeout: 30_000 })
    await reactReady(box(page))
    await box(page).fill(`두 과제를 합쳐 줘 [[merge_projects ${JSON.stringify({ source: source.id, target: target.id })}]]`)
    await box(page).press("Enter")

    // 미리보기 — 업무 2 → 0, 0 → 2, 원본 보관. 아직 아무것도 바뀌지 않았다
    const card = page.locator("[data-agent-card=PENDING]")
    await expect(card).toBeVisible({ timeout: 60_000 })
    await expect(card).toContainText(`${source.name} → ${target.name}`)
    await expect(card).toContainText("2건")
    await expect(card).toContainText("보관")
    expect(await prisma.task.count({ where: { projectId: source.id } })).toBe(2)

    // 확인 — runTool(confirm=true) → lib/project-merge mergeProjects. 단추가 화면에 붙은 뒤 누른다(개발 서버의 늦은 연결)
    const ok = card.getByRole("button", { name: "확인" })
    await reactReady(ok)
    await ok.click()
    await expect(page.locator("[data-agent-card=EXECUTED]")).toBeVisible({ timeout: 60_000 })
    expect(await prisma.task.count({ where: { projectId: target.id } })).toBe(2)
    expect((await prisma.project.findUniqueOrThrow({ where: { id: source.id } })).archived).toBe(true)
    const log = await prisma.activityLog.findFirst({ where: { entity: "PROJECT", entityId: target.id, action: "project.merged" } })
    expect(log?.title).toContain(source.name)
  } finally {
    await prisma.taskEvent.deleteMany({ where: { taskId: { in: tasks.map((t) => t.id) } } }).catch(() => {})
    await prisma.task.deleteMany({ where: { id: { in: tasks.map((t) => t.id) } } })
    await prisma.activityLog.deleteMany({ where: { entityId: { in: [source.id, target.id] } } })
    await prisma.project.deleteMany({ where: { id: { in: [source.id, target.id] } } })
    await prisma.$disconnect()
  }
})
