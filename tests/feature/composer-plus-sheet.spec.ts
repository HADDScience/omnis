/**
 * 폰의 ＋ 시트(components/chat/composer-plus-sheet.tsx). 데모 빌드에는 첨부가 없어 언급 항목으로 본다 —
 * 사진 · 파일 · 시놀로지 · 첨부 유지는 일반 빌드에서 scripts/verify-composer-plus-sheet.mjs 로 본다.
 */
import { expect, test, type Page } from "@playwright/test"
import { quickLogin } from "./_setup"

const COMPANY = "/chat/default-room"
const box = (page: Page) => page.locator("[data-composer-pill] textarea").first()
const plus = (page: Page) => page.locator('[data-composer-pill] button[aria-label="추가"]').first()
const sheet = (page: Page) => page.locator("[data-composer-plus-sheet]")

async function open(page: Page) {
  await quickLogin(page, "팀장")
  await page.goto(COMPANY)
  await box(page).waitFor({ timeout: 30_000 })
  await expect.poll(() => box(page).evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))), { timeout: 30_000 }).toBe(true)
}

test.describe("폰", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test("＋ 는 키보드를 내리고 시트를 연다. 쓰던 글은 그대로다", async ({ page }) => {
    await open(page)
    await box(page).tap()
    await box(page).fill("쓰던 글")
    await plus(page).tap()
    await expect(sheet(page)).toBeVisible()
    expect(await box(page).evaluate((el) => document.activeElement === el)).toBe(false)
    await expect(page.getByRole("menuitem")).toHaveCount(0)
    const labels = await sheet(page).locator("button").allInnerTexts()
    // 시험 빌드는 가짜 NAS 와 함께 첨부를 연다(NEXT_PUBLIC_E2E_ATTACH) — 첨부 항목(사진 · 파일 · 시놀로지)이 앞에 붙는다
    expect(labels.map((t) => t.split("\n")[0].trim())).toEqual(["사진", "파일 업로드", "시놀로지 파일 연결", "업무 지시", "사람 언급", "업무 언급"])
    // 화면 아래에 붙고 안전 영역 + 여백이 있다
    await expect.poll(() => sheet(page).evaluate((el) => Math.round(el.getBoundingClientRect().bottom))).toBe(844)
    expect(await sheet(page).evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom))).toBeGreaterThanOrEqual(16)
    await expect(box(page)).toHaveValue("쓰던 글")
  })

  test("어두운 바탕을 누르면 닫힌다", async ({ page }) => {
    await open(page)
    await plus(page).tap()
    await expect(sheet(page)).toBeVisible()
    await page.waitForTimeout(600)
    await page.touchscreen.tap(195, 120)
    await expect(sheet(page)).toBeHidden()
    await expect(plus(page)).toBeEnabled()
  })

  test("아래로 밀면 닫힌다", async ({ page }) => {
    await open(page)
    await plus(page).tap()
    await expect(sheet(page)).toBeVisible()
    await page.waitForTimeout(600)
    const r = (await sheet(page).boundingBox())!
    const x = r.x + r.width / 2
    const cdp = await page.context().newCDPSession(page)
    const touch = (type: string, y?: number) =>
      cdp.send("Input.dispatchTouchEvent", { type: type as "touchStart", touchPoints: y === undefined ? [] : [{ x, y }] })
    await touch("touchStart", r.y + 8)
    for (let i = 1; i <= 8; i++) {
      await touch("touchMove", r.y + 8 + i * 30)
      await page.waitForTimeout(16)
    }
    await touch("touchEnd")
    await expect(sheet(page)).toBeHidden()
  })

  test("항목을 고르면 시트가 닫히고 입력칸에서 이어 쓴다", async ({ page }) => {
    await open(page)
    await plus(page).tap()
    await sheet(page).getByRole("button", { name: "사람 언급" }).tap()
    await expect(sheet(page)).toBeHidden()
    await expect(box(page)).toHaveValue("@")
    await expect(page.locator("[data-composer-autocomplete]")).toBeVisible()
    expect(await box(page).evaluate((el) => document.activeElement === el)).toBe(true)
  })

  test("업무 지시 항목", async ({ page }) => {
    await open(page)
    await box(page).fill("보고서")
    await plus(page).tap()
    await sheet(page).getByRole("button", { name: "업무 지시" }).tap()
    await expect(sheet(page)).toBeHidden()
    await expect(box(page)).toHaveValue("/업무 보고서")
    expect(await box(page).evaluate((el) => document.activeElement === el)).toBe(true)
  })
})

test("PC 는 기존 메뉴 그대로다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await open(page)
  await plus(page).click()
  await expect(page.getByRole("menuitem").first()).toBeVisible()
  expect((await page.getByRole("menuitem").allInnerTexts()).map((t) => t.split("\n")[0].trim())).toEqual(["파일 업로드", "시놀로지 파일 연결", "업무 지시", "사람 언급", "업무 언급"])
  await expect(sheet(page)).toHaveCount(0)
})
