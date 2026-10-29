/**
 * 메신저 목록 — 폴더를 만들면 그 칩이 칩 줄에서 「보이는가」 (2026-10-29 제보 재현).
 *
 *   BASE_URL=http://localhost:3102 E2E_PASSWORD=… pnpm exec playwright test tests/feature/chat-folders.spec.ts --project=feature
 *
 * 제보: 팀장 계정이 폴더 「테스트」 를 만들었는데 칩 줄에 보이지 않았다. 칩은 DOM 에 있었지만
 * 고정 칩 넷이 목록 칸(1440px 에서 281px)을 다 채워 새 칩이 줄 밖(282~340px)에 그려졌고, 스크롤바를 숨겨
 * PC 마우스 휠로는 갈 수 없었다. 「DOM 에 있다」 가 아니라 「줄의 보이는 칸 안에 있다」 를 본다.
 * 만든 폴더는 끝에 API 로 지운다.
 */
import { expect, test, type Page } from "@playwright/test"
import { DEMO_PASSWORD } from "./_setup"

// tests/helpers 의 login 은 로그인 뒤 /tasks 를 기다리는데 지금은 /chat 으로 간다. 하이드레이션 전에 누르면
// 폼이 먹지 않아(scripts/narrow-audit.mjs 와 같은 함정) 버튼이 살아날 때까지 기다렸다 누른다
async function login(page: Page, name: string) {
  await page.goto("/login", { waitUntil: "networkidle" })
  await page.waitForTimeout(1500)
  await page.locator('input[type="text"]').first().fill(name)
  await page.locator('input[type="password"]').first().fill(DEMO_PASSWORD)
  await page.getByRole("button", { name: "로그인", exact: true }).click()
  await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 40_000 })
}

/** 칩이 칩 줄의 보이는 칸 안에 온전히 있는가 */
async function chipFullyShown(page: Page, label: string) {
  return page.evaluate((label) => {
    const bar = document.querySelector<HTMLElement>('[role="group"][aria-label="방 거르기"]')
    const chip = [...(bar?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.trim() === label)
    if (!bar || !chip) return false
    const b = bar.getBoundingClientRect()
    const c = chip.getBoundingClientRect()
    return c.left >= b.left - 1 && c.right <= b.right + 1 && c.width > 0
  }, label)
}

test("폴더를 만들면 그 칩이 칩 줄에 보이고 골라져 있다 (1440px)", async ({ page }) => {
  const name = `재현 ${Date.now() % 100000}`
  await login(page, "팀장")
  await page.goto("/chat")
  await page.locator('nav[aria-label="채팅방"] a').first().waitFor()

  await page.getByRole("button", { name: "폴더 관리" }).click()
  const dialog = page.locator("[data-slot='dialog-content']")
  await dialog.getByRole("textbox", { name: "새 폴더 이름" }).fill(name)
  await dialog.getByRole("button", { name: "폴더 만들기" }).click()
  await dialog.locator("li", { hasText: name }).waitFor()
  await page.keyboard.press("Escape")

  const chip = page.locator('[role="group"][aria-label="방 거르기"] button', { hasText: name })
  await expect(chip).toHaveAttribute("aria-pressed", "true")
  await expect.poll(() => chipFullyShown(page, name)).toBe(true)

  // 새로고침해도 그 칩이 남고(기억) 보인다
  await page.reload()
  await expect(chip).toHaveAttribute("aria-pressed", "true")
  await expect.poll(() => chipFullyShown(page, name)).toBe(true)

  // 넘친 칩이 있으면 줄 끝에 「더 보기」 표시가 뜨고, 세로 휠로도 줄이 가로로 밀린다
  await page.getByRole("button", { name: "전체", exact: true }).click()
  const bar = page.locator('[role="group"][aria-label="방 거르기"]')
  const overflow = await bar.evaluate((el) => el.scrollWidth > el.clientWidth)
  if (overflow) {
    await bar.evaluate((el) => (el.scrollLeft = 0))
    await expect(page.getByRole("button", { name: "뒤 칩 더 보기" })).toBeVisible()
    await bar.hover()
    await page.mouse.wheel(0, 400)
    await expect.poll(() => bar.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
  }

  const folders = (await (await page.request.get("/api/chat/folders")).json()) as { folders: { id: string; name: string }[] }
  for (const f of folders.folders.filter((x) => x.name === name)) await page.request.delete(`/api/chat/folders/${f.id}`)
})
