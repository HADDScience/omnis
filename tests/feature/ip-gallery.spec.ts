/**
 * 지식재산권 목록의 「목록 / 갤러리」 보기 · 건별 이미지. 규칙의 단위 시험: lib/ip-images.test.ts
 * 이미지 올리기는 가짜 NAS(scripts/e2e-fake-nas.mjs)가 떠 있을 때만 돈다 — CI 는 띄운다.
 */
import { expect, test, type Page } from "@playwright/test"
import { login } from "./_setup"

/** IP API 는 같은 오리진 요청만 쿠키로 받는다(lib/ip-api.ts authorize). 브라우저가 붙이는 머리글을 시험 요청에도 단다 */
const SAME = { "sec-fetch-site": "same-origin" }

const NAS = process.env.E2E_FAKE_NAS_URL
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==",
  "base64",
)

/** 시험 건을 만든다 — 아이디어(출원전) 단계의 상표. 지울 때는 removeCase */
async function createCase(page: Page, name: string): Promise<string> {
  const res = await page.request.post("/api/ip/cases", { headers: SAME, data: { kind: "trademark", name, status: "출원전" } })
  expect(res.status(), "건 만들기").toBe(200)
  return ((await res.json()) as { id: string }).id
}

async function removeCase(page: Page, id: string) {
  await page.request.delete(`/api/ip/entity?entity=trademarks&id=${encodeURIComponent(id)}`, { headers: SAME })
}

/** IP 목록을 연다. 첫 방문 튜토리얼은 본 것으로 둔다 */
async function openRegister(page: Page) {
  await page.request.post("/api/ip/prefs", { headers: SAME, data: { tutorialSeen: true } })
  await page.goto("/ip/register")
  await expect(page.getByRole("radiogroup", { name: "보기" })).toBeVisible({ timeout: 30_000 })
}

async function switchLayout(page: Page, label: "목록" | "갤러리") {
  await page.getByRole("radiogroup", { name: "보기" }).getByRole("radio", { name: label }).click()
}

test.describe("지식재산권 갤러리 @archive", () => {
  const stamp = Date.now().toString(36)

  // 지키는 것: 갤러리로 바꾸면 건마다 카드(이미지 없으면 첫 글자)가 보이고, 새로고침해도 갤러리로 남으며, 카드를 누르면 상세가 열린다
  test("목록 / 갤러리 전환 · 기억 · 카드에서 상세", async ({ page }) => {
    await login(page, "팀장")
    const name = `zgallery${stamp}`
    const id = await createCase(page, name)
    try {
      await openRegister(page)
      await switchLayout(page, "갤러리")
      const card = page.locator(`[data-gallery-card="${id}"]`)
      await expect(card).toBeVisible()
      await expect(card.locator("[data-gallery-placeholder]")).toHaveText("Z")
      await expect(card).toContainText("출원전")

      await page.reload()
      await expect(page.getByRole("radio", { name: "갤러리" })).toHaveAttribute("aria-checked", "true")
      await expect(page.locator(`[data-gallery-card="${id}"]`)).toBeVisible()

      await page.locator(`[data-gallery-card="${id}"]`).click()
      const dialog = page.getByRole("dialog")
      await expect(dialog.getByRole("heading", { name })).toBeVisible()
      await expect(dialog.locator("[data-case-images]")).toContainText("아직 이미지가 없습니다")
      await page.keyboard.press("Escape")

      await switchLayout(page, "목록")
      await expect(page.locator("table")).toBeVisible()
    } finally {
      await removeCase(page, id)
    }
  })

  // 지키는 것: 출원 전 건에도 시안 이미지를 메모 · 날짜와 함께 올릴 수 있고, 첫 이미지가 대표가 되어 갤러리 표지로 보인다
  test("상세에서 이미지 올리기 → 대표 → 갤러리 표지", async ({ page }) => {
    test.skip(!NAS, "가짜 NAS 가 없다(E2E_FAKE_NAS_URL)")
    await login(page, "팀장")
    const name = `zimage${stamp}`
    const id = await createCase(page, name)
    try {
      await openRegister(page)
      await switchLayout(page, "갤러리")
      await page.locator(`[data-gallery-card="${id}"]`).click()
      const dialog = page.getByRole("dialog")
      await dialog.getByLabel(`${name} 이미지 파일 고르기`).setInputFiles({ name: "시안.png", mimeType: "image/png", buffer: PNG })
      await dialog.getByLabel("이미지 메모").fill("10/29 변리사 송부 시안")
      await dialog.getByLabel("이미지 날짜").fill("2026-10-29")
      await dialog.getByRole("button", { name: "올리기" }).click()

      const tile = dialog.locator("[data-case-image]")
      await expect(tile).toHaveCount(1)
      await expect(tile).toHaveAttribute("data-primary", "")
      await expect(tile).toContainText("10/29 변리사 송부 시안")
      await expect(tile).toContainText("2026.10.29")
      await page.keyboard.press("Escape")

      const cover = page.locator(`[data-gallery-card="${id}"] img`)
      await expect(cover).toBeVisible()
      await expect(page.locator(`[data-gallery-card="${id}"] [data-gallery-placeholder]`)).toHaveCount(0)

      const res = await page.request.get(`/api/ip/images?kind=trademark&id=${encodeURIComponent(id)}`, { headers: SAME })
      const { images } = (await res.json()) as { images: { id: string; isPrimary: boolean }[] }
      expect(images).toHaveLength(1)
      expect(images[0].isPrimary).toBe(true)
      await page.request.delete(`/api/ip/images?id=${images[0].id}`, { headers: SAME })
    } finally {
      await removeCase(page, id)
    }
  })

  // 지키는 것: 폰 폭에서 갤러리가 가로로 넘치지 않는다(카드 2열, 긴 이름 · 번호는 잘리거나 줄을 바꾼다)
  test("폰 갤러리 — 가로 넘침 없음 @mobile", async ({ page }) => {
    await login(page, "팀장")
    const id = await createCase(page, `zverylongtrademarkname${stamp}withoutspaces`)
    try {
      await openRegister(page)
      await switchLayout(page, "갤러리")
      await expect(page.locator(`[data-gallery-card="${id}"]`)).toBeVisible()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow, "가로 넘침(px)").toBeLessThanOrEqual(0)
      const box = await page.locator(`[data-gallery-card="${id}"]`).boundingBox()
      expect(box!.x + box!.width, "카드 오른쪽 끝").toBeLessThanOrEqual(390)
    } finally {
      await removeCase(page, id)
    }
  })
})
