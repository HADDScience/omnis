/**
 * 업무 상세의 「Omnis 와 함께 업무 시작하기」 — 확인 한 번 → 옴니스 새 대화 → 첫 글 자동 제출(한 번만).
 * PC 는 업무 화면에 남고 오른쪽 패널의 옴니스 탭이, 폰은 /chat/new 가 연다. 첫 글 모양의 단위 시험: lib/task-start.test.ts
 *
 * 옴니스 실행(에이전트)은 시험에서 돌리지 않는다 — 보내는 요청을 받아 적고 429 로 돌려준다. 실패했을 때 입력칸에 글이 남는지도 이것으로 본다.
 * 시험할 업무를 시험 DB 에서 고른다 — 로컬 DB(CI · e2e-local)에서만 돈다.
 */
import { expect, test, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { login } from "./_setup"

const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")
test.skip(!LOCAL_DB, "시험 DB 에서 업무를 고른다")

const prisma = LOCAL_DB ? new PrismaClient() : (null as unknown as PrismaClient)
let task: { id: string; slug: string; name: string; open: string[] }

const tag = `e2e-start-${Date.now()}`

test.beforeAll(async () => {
  const found = await prisma.task.findFirstOrThrow({ orderBy: { createdAt: "asc" } })
  // 데모 시드의 업무에는 남은 체크리스트가 없을 수 있다 — 시험용 둘을 넣고 끝나면 지운다
  await prisma.checklist.createMany({ data: [{ taskId: found.id, name: `${tag} 시료 받기` }, { taskId: found.id, name: `${tag} 결과 정리` }] })
  const open = await prisma.checklist.findMany({ where: { taskId: found.id, done: false }, orderBy: [{ done: "asc" }, { createdAt: "asc" }] })
  task = { id: found.id, slug: found.slug, name: found.name, open: open.map((c) => c.name) }
})
test.afterAll(async () => {
  await prisma?.checklist.deleteMany({ where: { name: { startsWith: tag } } })
  await prisma?.$disconnect()
})

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

async function quiet(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("omnis:nudge-off:install", "1")
    localStorage.setItem("omnis:nudge-off:push", "1")
  })
}

const button = (page: Page) => page.locator("[data-start-with-omnis]")
const confirmBox = (page: Page) => page.locator("[data-start-with-omnis-confirm]")

function expectPrompt(text: string) {
  expect(text.split("\n")[0]).toBe(`#${task.slug} 「${task.name}」 업무를 지금부터 함께 진행하자. 먼저 남은 체크리스트를 기준으로 다음 할 일을 제안해 줘.`)
  expect(text).toContain(`- 업무: #${task.slug} (ID ${task.id})`)
  expect(text).toContain(`- 남은 체크리스트 ${task.open.length}개:`)
  expect(text).toContain(`  - ${task.open[0]}`)
}

test.describe("PC", () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test("확인 → 업무 화면에 남은 채 패널 옴니스 새 대화가 열리고 첫 글이 한 번 보내진다 · 실패하면 입력칸에 남는다", async ({ page }) => {
    await quiet(page)
    const asked = await recordAsks(page)
    await login(page, "팀장")
    await page.goto(`/tasks/${task.id}`)
    await button(page).click()
    await expect(confirmBox(page)).toContainText("이 업무를 옴니스와 시작할까요?")
    await expect(confirmBox(page)).toContainText(task.name)
    // 더블 클릭해도 한 번만
    await confirmBox(page).getByRole("button", { name: "시작하기" }).dblclick()
    await expect(confirmBox(page)).toHaveCount(0)

    const panel = page.getByRole("complementary", { name: "대화 패널" })
    await expect(panel).toBeVisible()
    // 패널 채팅의 옴니스 새 대화(2026-11-11 — 예전 「옴니스」 탭)
    await expect(panel.locator('[data-panel-messenger="room"]')).toBeVisible()
    await expect(panel.locator("[data-room-header]").filter({ visible: true })).toContainText("새 대화")
    await expect.poll(() => asked.length, { timeout: 15_000 }).toBe(1)
    expectPrompt(asked[0])
    expect(new URL(page.url()).pathname).toBe(`/tasks/${task.id}`)
    // 429 — 보낸 글이 입력칸에 돌아와 손으로 다시 보낼 수 있다
    await expect(panel.locator("[data-composer-pill] textarea")).toHaveValue(asked[0], { timeout: 15_000 })
    await page.waitForTimeout(800)
    expect(asked).toHaveLength(1)
  })

  test("취소하면 아무것도 보내지 않는다", async ({ page }) => {
    await quiet(page)
    const asked = await recordAsks(page)
    await login(page, "팀장")
    await page.goto(`/tasks/${task.id}`)
    await button(page).click()
    await confirmBox(page).getByRole("button", { name: "취소" }).click()
    await expect(confirmBox(page)).toHaveCount(0)
    await page.waitForTimeout(800)
    expect(asked).toHaveLength(0)
    expect(new URL(page.url()).pathname).toBe(`/tasks/${task.id}`)
  })
})

test.describe("폰", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test("확인 → 옴니스 새 대화 화면에서 첫 글이 한 번 보내지고, 뒤로 갔다 다시 들어와도 다시 보내지 않는다", async ({ page }) => {
    await quiet(page)
    const asked = await recordAsks(page)
    await login(page, "팀장")
    await page.goto(`/tasks/${task.id}`)
    const box = (await button(page).boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(40)
    await button(page).tap()
    await expect(confirmBox(page)).toContainText(task.name)
    await confirmBox(page).getByRole("button", { name: "시작하기" }).tap()
    await page.waitForURL(/\/chat\/new\?start=/)
    await expect.poll(() => asked.length, { timeout: 15_000 }).toBe(1)
    expectPrompt(asked[0])
    await expect(page.locator("[data-composer-pill] textarea").first()).toHaveValue(asked[0], { timeout: 15_000 })

    await page.goBack()
    await page.waitForURL(`**/tasks/${task.id}`)
    await page.goForward()
    await page.waitForURL(/\/chat\/new\?start=/)
    await page.waitForTimeout(1_500)
    expect(asked).toHaveLength(1)
    // 새로고침해도 같은 키는 다시 보내지 않는다
    await page.reload()
    await page.waitForTimeout(1_500)
    expect(asked).toHaveLength(1)
  })
})
