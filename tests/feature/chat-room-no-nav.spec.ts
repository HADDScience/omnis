/**
 * 폰 대화방에는 하단 nav 가 없다. 어떻게 들어와도(목록 · 주소 직접 · 새로고침) 뒤로 캡슐로 목록에 돌아가고, 목록에서 nav 가 다시 보인다.
 * 입력창은 화면 아래 안전 영역에 붙는다. 안전 영역은 시험 브라우저에 없어 변수를 34px 로 준다.
 */
import { expect, test, type Page } from "@playwright/test"
import { quickLogin } from "./_setup"

const NAV = 'nav[aria-label="주 메뉴"]'
const BACK = 'section a[aria-label="채팅방 목록으로"]'
const PILL = "section [data-composer-pill]"

async function roomUrls(page: Page) {
  const users = (await (await page.request.get("/api/users")).json()) as { id: string; name: string }[]
  const res = await page.request.post("/api/chat/people-rooms", { data: { userIds: [users.find((u) => u.name === "사원1")!.id] } })
  const group = await page.request.post("/api/chat/people-rooms", { data: { userIds: users.filter((u) => u.name === "사원1" || u.name === "사원2").map((u) => u.id) } })
  const data = (await (await page.request.get("/api/tasks")).json()) as { id: string }[] | { tasks: { id: string }[] }
  const tasks = Array.isArray(data) ? data : data.tasks
  return {
    전사: "/chat/default-room",
    "1:1": `/chat/${((await res.json()) as { roomId: string }).roomId}`,
    단톡: `/chat/${((await group.json()) as { roomId: string }).roomId}`,
    업무: `/chat/task/${tasks[0].id}`,
    옴니스: "/chat/new",
  }
}

const bottomOf = (page: Page) => page.locator(PILL).first().evaluate((el) => el.getBoundingClientRect().bottom)

test.describe("폰", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test("주소로 바로 들어와도 nav 가 없고 뒤로 캡슐로 목록에 돌아가면 nav 가 보인다", async ({ page }) => {
    await quickLogin(page, "팀장")
    for (const [name, url] of Object.entries(await roomUrls(page))) {
      await page.goto(url)
      await page.locator(PILL).first().waitFor({ timeout: 30_000 })
      await expect(page.locator(`${NAV}:visible`), name).toHaveCount(0)
      await expect(page.locator(BACK).first(), name).toBeVisible()
      // 입력창 칸 8px 위에 뜬다. 맨 아래까지 칸이 닿으므로 옛 nav 자리가 비지 않는다
      await expect.poll(() => bottomOf(page), name).toBe(844 - 8)

      await page.reload()
      await page.locator(PILL).first().waitFor({ timeout: 30_000 })
      await expect(page.locator(`${NAV}:visible`), `${name} 새로고침`).toHaveCount(0)

      await page.locator(BACK).first().tap()
      await page.waitForURL("**/chat")
      await expect(page.locator(NAV).last(), name).toBeVisible()
    }
  })

  test("입력창이 화면 아래 안전 영역 위에 놓인다", async ({ page }) => {
    await quickLogin(page, "팀장")
    await page.goto("/chat/default-room")
    await page.locator(PILL).first().waitFor({ timeout: 30_000 })
    await page.evaluate(() => document.documentElement.style.setProperty("--safe-bottom", "34px"))
    await expect.poll(() => bottomOf(page)).toBe(844 - 34 - 8)
  })

  test("사람과 대화 고르기 화면도 뒤로 갈 수 있다", async ({ page }) => {
    await quickLogin(page, "팀장")
    await page.goto("/chat/new/people")
    await expect(page.locator(BACK).first()).toBeVisible({ timeout: 30_000 })
    await expect(page.locator(`${NAV}:visible`)).toHaveCount(0)
  })

  test("다른 화면의 nav 는 그대로다", async ({ page }) => {
    await quickLogin(page, "팀장")
    for (const url of ["/chat", "/tasks", "/calendar"]) {
      await page.goto(url)
      await expect(page.locator(NAV).last(), url).toBeVisible({ timeout: 30_000 })
    }
  })
})

test.describe("PC", () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test("대화방에서도 위쪽 nav 가 그대로다", async ({ page }) => {
    await quickLogin(page, "팀장")
    await page.goto("/chat/default-room")
    await page.locator(PILL).first().waitFor({ timeout: 30_000 })
    await expect(page.locator(NAV).first()).toBeVisible()
  })
})
