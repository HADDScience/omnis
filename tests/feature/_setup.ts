import { type Page, expect } from "@playwright/test"

export const DEMO_PASSWORD = process.env.E2E_PASSWORD ?? "demo1234"

export const ADMINS = ["팀장", "부팀장"] as const
export const MEMBERS = ["사원1", "사원2", "사원3"] as const
export const ALL_USERS = [...ADMINS, ...MEMBERS] as const
export type DemoUser = (typeof ALL_USERS)[number]

export async function login(
  page: Page,
  name: DemoUser,
  password = DEMO_PASSWORD
) {
  await page.goto("/login")
  await page.getByRole("textbox", { name: "이름" }).fill(name)
  await page.getByRole("textbox", { name: "비밀번호" }).fill(password)
  await page.getByRole("button", { name: "로그인", exact: true }).click()
  await page.waitForURL("**/chat", { timeout: 15_000 })
}

export async function quickLogin(page: Page, name: DemoUser) {
  await page.goto("/login")
  await page.getByRole("button", { name, exact: true }).click()
  await page.waitForURL("**/chat", { timeout: 15_000 })
}

export async function expectLoggedIn(page: Page, name: DemoUser) {
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 5_000 })
}

export async function openChatDock(page: Page) {
  const input = page.getByPlaceholder(
    "메시지 입력...  / 명령 · @ 사람 · # 업무"
  )
  if (!(await input.isVisible())) {
    // 제목줄의 「채팅 열기」 는 지웠다(2026-10-29) — 오른쪽 아래 둥근 단추가 패널을 연다.
    // 그 단추는 채팅 화면(로그인하면 들어오는 곳)에서는 숨으므로 업무 화면으로 옮겨 간다
    if (new URL(page.url()).pathname.startsWith("/chat")) await page.goto("/tasks")
    await page.getByRole("button", { name: /^대화 패널 열기/ }).click()
  }
  await expect(input).toBeVisible()
}
