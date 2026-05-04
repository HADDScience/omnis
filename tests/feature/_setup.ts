import { type Page, expect } from "@playwright/test"

export const DEMO_PASSWORD = process.env.E2E_PASSWORD ?? "demo1234"

export const ADMINS = ["팀장", "부팀장"] as const
export const MEMBERS = ["사원1", "사원2", "사원3"] as const
export const ALL_USERS = [...ADMINS, ...MEMBERS] as const
export type DemoUser = (typeof ALL_USERS)[number]

export async function login(page: Page, name: DemoUser, password = DEMO_PASSWORD) {
  await page.goto("/login")
  await page.getByRole("textbox", { name: "이름" }).fill(name)
  await page.getByRole("textbox", { name: "비밀번호" }).fill(password)
  await page.getByRole("button", { name: "로그인", exact: true }).click()
  await page.waitForURL("**/dashboard", { timeout: 15_000 })
}

export async function quickLogin(page: Page, name: DemoUser) {
  await page.goto("/login")
  await page.getByRole("button", { name, exact: true }).click()
  await page.waitForURL("**/dashboard", { timeout: 15_000 })
}

export async function expectLoggedIn(page: Page, name: DemoUser) {
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 5_000 })
}

export const CHAT_DOCK_OPEN_BUTTON_TITLE = "열기"

export async function openChatDock(page: Page) {
  const opened = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => (b as HTMLButtonElement).title === "열기",
    ) as HTMLButtonElement | undefined
    if (btn) {
      btn.click()
      return true
    }
    return false
  })
  if (opened) {
    await page.waitForTimeout(400)
  }
  await page
    .getByRole("textbox", { name: /메시지 입력/ })
    .first()
    .waitFor({ state: "visible", timeout: 5_000 })
}
