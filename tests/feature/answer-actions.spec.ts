/**
 * 옴니스 답 — 표 칸 복사 · 화면 글 복사 · 답 아래 동작 줄(복사 · 좋아요/싫어요 · 소리내어 읽기 · 공유 · 더 보기).
 * 데모 시드의 부팀장 옴니스 방 「시험 — 표 답변 복사」(prisma/demo-seed.ts seedOmnisTableAnswer)를 읽기만 한다 — AI 를 부르지 않는다.
 * 정리 규칙의 단위 시험: lib/answer-clipboard.test.ts. ANSWER_SHOTS=<폴더> 면 화면과 클립보드 html(clipboard.html)을 남긴다.
 *
 *   node scripts/e2e-local.mjs tests/feature/answer-actions.spec.ts
 */
import fs from "node:fs"
import path from "node:path"
import { expect, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test"
import { quickLogin } from "./_setup"

const ROOM = "demo-omnis-table-answer"
const SHOTS = process.env.ANSWER_SHOTS
const PC: BrowserContextOptions = { viewport: { width: 1440, height: 900 } }
const PHONE: BrowserContextOptions = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }

async function open(browser: Browser, device: BrowserContextOptions, extra: BrowserContextOptions = {}) {
  const ctx = await browser.newContext({ ...device, ...extra, permissions: ["clipboard-read", "clipboard-write"] })
  const page = await ctx.newPage()
  await page.addInitScript(() => {
    localStorage.setItem("omnis:nudge-off:install", "1")
    localStorage.setItem("omnis:nudge-off:push", "1")
  })
  await quickLogin(page, "부팀장")
  await page.goto(`/chat/${ROOM}`)
  await expect(answer(page)).toBeVisible({ timeout: 15_000 })
  return { ctx, page }
}

// 방 화면의 답 — 오른쪽 패널에 같은 방이 함께 떠 있어도 id(앵커)는 방 화면에만 있다
const answer = (page: Page) => page.locator("[data-omnis-message][id^=\"m-\"]").first()
const toolbar = (page: Page) => answer(page).locator("[data-answer-actions]")

async function readClipboard(page: Page): Promise<{ html: string; text: string }> {
  return page.evaluate(async () => {
    const items = await navigator.clipboard.read()
    let html = ""
    let text = ""
    for (const item of items) {
      if (item.types.includes("text/html")) html = await (await item.getType("text/html")).text()
      if (item.types.includes("text/plain")) text = await (await item.getType("text/plain")).text()
    }
    return { html, text }
  })
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) })
}

test.describe("옴니스 답 복사 · 동작 줄", () => {
  test.describe.configure({ mode: "serial" })

  test("PC — 복사 단추는 표를 표로(text/html) · 마크다운 원문(text/plain)으로, 각주는 빠진다", async ({ browser }) => {
    const { ctx, page } = await open(browser, PC)
    await expect(toolbar(page)).toBeVisible()
    for (const name of ["답 복사", "좋은 답", "아쉬운 답", "소리내어 읽기", "공유", "더 보기"]) {
      await expect(toolbar(page).getByRole("button", { name, exact: true })).toBeVisible()
    }
    await answer(page).scrollIntoViewIfNeeded()
    await shot(page, "pc-answer")

    await toolbar(page).getByRole("button", { name: "답 복사" }).click()
    await expect(toolbar(page).locator("[data-answer-copied]")).toHaveText("복사됨")
    const clip = await readClipboard(page)
    expect(clip.html).toMatch(/<table style="border-collapse:collapse;[^"]*">/)
    expect(clip.html).toMatch(/<th style="[^"]*font-weight:bold;[^"]*">사업<\/th>/)
    expect(clip.html).toMatch(/<td style="border:1px solid #999;padding:4px 8px;[^"]*">공급망 안정화<\/td>/)
    expect(clip.html).toContain("<strong>세 건</strong>")
    expect(clip.html).toMatch(/<ul><li>[^<]*<strong>제품 B 인허가 일정표<\/strong>/)
    expect(clip.html).not.toMatch(/class=|\[\d\]|<button/)
    expect(clip.text).toContain("지원사업 **세 건**의 진행 현황입니다.")
    expect(clip.text).toContain("| 바이오 소재 실증연구 | 사원1 | 서류 보완 | 11월 14일 |")
    expect(clip.text).not.toMatch(/\[\d\]/)
    if (SHOTS) {
      fs.writeFileSync(path.join(SHOTS, "clipboard.html"), clip.html)
      fs.writeFileSync(path.join(SHOTS, "clipboard-button.txt"), clip.text)
    }
    await ctx.close()
  })

  test("PC — 표 칸 범위를 끌어 Ctrl/⌘+C 하면 고른 열의 머리와 함께 표 · 탭 글", async ({ browser }) => {
    const { ctx, page } = await open(browser, PC)
    const sheet = answer(page).locator("[data-copyable-sheet]")
    const cell = (r: number, c: number) => sheet.locator("tbody tr").nth(r + 1).locator("td").nth(c)
    await expect(cell(0, 0)).toContainText("바이오 소재 실증연구")
    const a = (await cell(0, 0).boundingBox())!
    const b = (await cell(1, 1).boundingBox())!
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 })
    await page.mouse.up()
    await page.keyboard.press("ControlOrMeta+c")
    const clip = await readClipboard(page)
    expect(clip.text).toBe("사업\t담당\n바이오 소재 실증연구\t사원1\n공급망 안정화\t부팀장")
    expect(clip.html).toMatch(/<thead><tr><th[^>]*>사업<\/th><th[^>]*>담당<\/th><\/tr><\/thead>/)
    expect(clip.html).not.toContain("단계")
    await shot(page, "pc-sheet-range")
    if (SHOTS) fs.writeFileSync(path.join(SHOTS, "clipboard-range.html"), clip.html)
    await ctx.close()
  })

  test("PC — 표 밖 글과 함께 끌어 고른 복사도 표는 표로, 각주 배지는 빠진다", async ({ browser }) => {
    const { ctx, page } = await open(browser, PC)
    await page.evaluate(() => {
      const body = document.querySelector("[data-omnis-message][id^=\"m-\"] [data-omnis-answer]")!
      const range = document.createRange()
      range.selectNodeContents(body)
      const sel = window.getSelection()!
      sel.removeAllRanges()
      sel.addRange(range)
    })
    await page.keyboard.press("ControlOrMeta+c")
    const clip = await readClipboard(page)
    expect(clip.html).toContain("<strong>세 건</strong>")
    expect(clip.html).toMatch(/<table style="[^"]+"><thead><tr><th[^>]*>사업<\/th>/)
    expect(clip.html).not.toMatch(/class=|<button|>1<\/|\[\d\]/)
    expect(clip.text).toContain("사업\t담당\t단계\t마감")
    expect(clip.text).toContain("바이오 소재 실증연구\t사원1\t서류 보완\t11월 14일")
    expect(clip.text).not.toMatch(/\[\d\]/)
    if (SHOTS) fs.writeFileSync(path.join(SHOTS, "clipboard-selection.html"), clip.html)
    await ctx.close()
  })

  test("PC — 좋아요/싫어요는 하나만 눌린다 · 소리내어 읽기는 「곧 제공됩니다」", async ({ browser }) => {
    const { ctx, page } = await open(browser, PC)
    const up = toolbar(page).getByRole("button", { name: "좋은 답" })
    const down = toolbar(page).getByRole("button", { name: "아쉬운 답" })
    await up.click()
    await expect(up).toHaveAttribute("aria-pressed", "true")
    await down.click()
    await expect(down).toHaveAttribute("aria-pressed", "true")
    await expect(up).toHaveAttribute("aria-pressed", "false")
    await toolbar(page).getByRole("button", { name: "소리내어 읽기" }).click()
    await expect(page.getByText("곧 제공됩니다")).toBeVisible()
    // 키보드로도 닿는다
    await toolbar(page).getByRole("button", { name: "답 복사" }).focus()
    await page.keyboard.press("Tab")
    await expect(up).toBeFocused()
    await ctx.close()
  })

  test("PC — 더 보기: 응답 시각(서울) · 응답 다시 생성 · 대화 브랜치(곧 제공)", async ({ browser }) => {
    const { ctx, page } = await open(browser, PC)
    await toolbar(page).getByRole("button", { name: "더 보기" }).click()
    const menu = page.locator("[data-answer-menu]")
    await expect(menu.locator("[data-answer-time]")).toHaveText(/^\d{1,2}월 \d{1,2}일, 오[전후] \d{1,2}:\d{2}$/)
    await expect(menu.getByRole("menuitem", { name: "응답 다시 생성" })).toBeVisible()
    await expect(menu.getByRole("menuitem", { name: "응답 다시 생성" })).not.toHaveAttribute("aria-disabled", "true")
    await shot(page, "pc-menu")
    await menu.getByRole("menuitem", { name: "대화 브랜치" }).click()
    await expect(page.getByText("곧 제공됩니다")).toBeVisible()
    await ctx.close()
  })

  test("PC — 공유: 대화 제목 · 답 미리보기 · 사내 안내 · 링크 복사, 링크는 그 답으로 간다", async ({ browser }) => {
    const { ctx, page } = await open(browser, PC)
    const id = await answer(page).getAttribute("data-omnis-message")
    await toolbar(page).getByRole("button", { name: "공유" }).click()
    const dialog = page.locator("[data-answer-share-dialog]")
    await expect(dialog.getByRole("heading", { name: "시험 — 표 답변 복사" })).toBeVisible()
    await expect(dialog.locator("[data-answer-share-preview]")).toContainText("공급망 안정화")
    await expect(dialog.locator("[data-answer-share-note]")).toContainText("회사 구성원만 볼 수 있음(로그인 필요)")
    // 바깥 공유 · 공개 링크는 없다
    // 미리보기 밖의 단추는 링크 복사 · 닫기 둘뿐
    const outside = await dialog.evaluate((d) =>
      Array.from(d.querySelectorAll("button, a")).filter((b) => !b.closest("[data-answer-share-preview]")).map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim()),
    )
    expect(outside.sort()).toEqual(["Close", "링크 복사"].sort())
    await shot(page, "pc-share")
    await dialog.getByRole("button", { name: "링크 복사" }).click()
    const link = await page.evaluate(() => navigator.clipboard.readText())
    expect(link).toBe(`${new URL(page.url()).origin}/chat/${ROOM}#m-${id}`)
    await page.keyboard.press("Escape")

    // 링크로 들어오면 그 답 자리로
    const other = await ctx.newPage()
    await other.goto(link)
    await expect(other.locator(`#m-${id}`)).toBeInViewport({ timeout: 15_000 })
    await ctx.close()
  })

  test("폰 — 동작 줄이 한 줄에 들어오고 가로로 넘치지 않는다 · 공유 창", async ({ browser }) => {
    const { ctx, page } = await open(browser, PHONE)
    const bar = toolbar(page)
    await bar.scrollIntoViewIfNeeded()
    const box = (await bar.boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    const buttons = bar.getByRole("button")
    const first = (await buttons.first().boundingBox())!
    const last = (await buttons.last().boundingBox())!
    expect(Math.abs(first.y - last.y)).toBeLessThan(2)
    expect(first.height).toBeGreaterThanOrEqual(40)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await shot(page, "phone-answer")
    await bar.getByRole("button", { name: "공유" }).click()
    const dialog = page.locator("[data-answer-share-dialog]")
    await expect(dialog).toBeVisible()
    const d = (await dialog.boundingBox())!
    expect(d.x).toBeGreaterThanOrEqual(0)
    expect(d.x + d.width).toBeLessThanOrEqual(390)
    await shot(page, "phone-share")
    await ctx.close()
  })

  test("다크 — 동작 줄 · 메뉴가 보인다", async ({ browser }) => {
    const { ctx, page } = await open(browser, PC, { colorScheme: "dark" })
    await page.evaluate(() => {
      document.documentElement.classList.add("dark")
      document.documentElement.style.colorScheme = "dark"
    })
    await answer(page).scrollIntoViewIfNeeded()
    await toolbar(page).getByRole("button", { name: "더 보기" }).click()
    await expect(page.locator("[data-answer-menu]")).toBeVisible()
    await shot(page, "pc-dark-menu")
    await ctx.close()
  })
})
