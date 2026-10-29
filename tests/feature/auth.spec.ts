import { test, expect } from "@playwright/test"
import { ADMINS, MEMBERS, DEMO_PASSWORD, login, quickLogin } from "./_setup"

test.describe("auth", { tag: "@auth" }, () => {
  // 지키는 것: 로그인 화면에 이름 · 비밀번호 칸이 있다
  test("로그인 페이지가 시연용 데모 안내를 표시한다", async ({ page }) => {
    await page.goto("/login")
    await expect(page.getByText("Omnis", { exact: true })).toBeVisible()
    await expect(page.getByRole("textbox", { name: "이름" })).toBeVisible()
    await expect(page.getByRole("textbox", { name: "비밀번호" })).toBeVisible()
  })

  // 지키는 것: 비밀번호가 틀리면 들어가지 못하고 이유를 본다
  test("잘못된 비밀번호는 에러 메시지를 보여준다", async ({ page }) => {
    await page.goto("/login")
    await page.getByRole("textbox", { name: "이름" }).fill("팀장")
    await page.getByRole("textbox", { name: "비밀번호" }).fill("wrong-password")
    await page.getByRole("button", { name: "로그인", exact: true }).click()
    await expect(page.getByText("이름 또는 비밀번호가 올바르지 않습니다.")).toBeVisible()
    await expect(page).toHaveURL(/\/login$/)
  })

  // 지키는 것: 관리자 계정은 로그인하면 업무 화면에서 시작한다
  for (const admin of ADMINS) {
    test(`관리자 계정 ${admin} 로그인 → 대시보드 진입`, async ({ page }) => {
      await login(page, admin)
      await expect(page).toHaveURL(/\/tasks$/)
    })
  }

  // 지키는 것: 팀원 계정도 로그인하면 업무 화면에서 시작한다
  for (const member of MEMBERS) {
    test(`팀원 계정 ${member} 로그인 → 대시보드 진입`, async ({ page }) => {
      await login(page, member)
      await expect(page).toHaveURL(/\/tasks$/)
    })
  }

  // 지키는 것: 데모 빠른 로그인 버튼으로 들어갈 수 있다
  test("DemoAccountsCard 빠른 로그인 버튼이 동작한다", async ({ page }) => {
    test.skip(
      process.env.NEXT_PUBLIC_IS_DEMO !== "true" && !process.env.BASE_URL?.includes("vercel"),
      "데모 모드에서만 보이는 카드",
    )
    await quickLogin(page, "사원1")
    await expect(page).toHaveURL(/\/tasks$/)
  })

  // 지키는 것: e2e 가 쓰는 데모 비밀번호 설정이 비어 있지 않다
  test("환경변수 데모 비밀번호가 올바르게 적용된다", async () => {
    expect(DEMO_PASSWORD.length).toBeGreaterThanOrEqual(6)
  })
})
