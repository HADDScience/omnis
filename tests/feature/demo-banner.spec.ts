import { test, expect } from "@playwright/test"
import { login } from "./_setup"

const IS_DEMO = process.env.NEXT_PUBLIC_IS_DEMO === "true" || !!process.env.BASE_URL?.includes("vercel")

test.describe("시연용 데모 배너 + 테스트 계정 카드", () => {
  test.skip(!IS_DEMO, "데모 모드에서만 노출됨")

  test("로그인 페이지에 floating 배너가 나타난다", async ({ page }) => {
    await page.goto("/login")
    await expect(page.getByRole("status", { name: "시연용 데모 사이트" })).toBeVisible()
    await expect(page.getByText("시연용 데모", { exact: true })).toBeVisible()
  })

  test("로그인 페이지에 5인 quick-login 버튼이 모두 보인다", async ({ page }) => {
    await page.goto("/login")
    for (const name of ["팀장", "부팀장", "사원1", "사원2", "사원3"]) {
      await expect(page.getByRole("button", { name, exact: true })).toBeVisible()
    }
  })

  test("로그인 후 대시보드에서도 배너가 유지된다 (sticky/fixed)", async ({ page }) => {
    await login(page, "팀장")
    await expect(page.getByRole("status", { name: "시연용 데모 사이트" })).toBeVisible()
  })

  test("배너가 헤더(Sidebar)와 겹치지 않는다 (회귀 방지)", async ({ page }) => {
    await login(page, "팀장")
    const banner = page.getByRole("status", { name: "시연용 데모 사이트" }).first()
    const sidebarLogo = page.getByRole("link", { name: /Omnis.*HADDScience/ }).first()

    const [bannerBox, sidebarBox] = await Promise.all([
      banner.boundingBox(),
      sidebarLogo.boundingBox(),
    ])
    expect(bannerBox).not.toBeNull()
    expect(sidebarBox).not.toBeNull()
    if (bannerBox && sidebarBox) {
      const overlap =
        bannerBox.x < sidebarBox.x + sidebarBox.width &&
        bannerBox.x + bannerBox.width > sidebarBox.x &&
        bannerBox.y < sidebarBox.y + sidebarBox.height &&
        bannerBox.y + bannerBox.height > sidebarBox.y
      expect(overlap).toBe(false)
    }
  })
})
