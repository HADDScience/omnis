import { test, expect } from "@playwright/test"
import { login, openChatDock } from "./_setup"

test.describe("/업무 슬래시 명령 → 업무 자동 등록", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "팀장")
    await openChatDock(page)
  })

  test("/업무 + 텍스트 + Enter → 업무 등록 다이얼로그가 열린다", async ({
    page,
  }) => {
    const textarea = page.getByPlaceholder(
      "메시지 입력...  / 명령 · @ 사람 · # 업무"
    )
    await textarea.fill("/업무 가벽 블라인드 설치 4월 21일 사원2 담당")
    await page.keyboard.press("Enter")
    await expect(page.getByRole("dialog", { name: "업무 등록" })).toBeVisible({
      timeout: 5_000,
    })
    await expect(
      page.getByText("/업무 가벽 블라인드 설치 4월 21일 사원2 담당")
    ).toBeVisible()
  })

  test("다이얼로그가 제목·담당자·속성·체크리스트·AI 자동완성 버튼을 모두 노출한다", async ({
    page,
  }) => {
    const textarea = page.getByPlaceholder(
      "메시지 입력...  / 명령 · @ 사람 · # 업무"
    )
    await textarea.fill("/업무 명함 6인 분할 업로드")
    await page.keyboard.press("Enter")

    const dialog = page.getByRole("dialog", { name: "업무 등록" })
    await expect(dialog).toBeVisible({ timeout: 5_000 })

    await expect(
      dialog.getByRole("group", { name: "담당자 선택" })
    ).toBeVisible()
    await expect(dialog.getByRole("textbox", { name: "제목" })).toBeVisible()
    for (const label of [
      "마감일",
      "프로젝트 (제품 자동 매핑)",
      "제품",
      "우선순위",
    ]) {
      await expect(dialog.getByText(label, { exact: true })).toBeVisible()
    }
    await expect(dialog.getByText(/^체크리스트 \(/)).toBeVisible()
    await expect(
      dialog.getByRole("button", { name: "AI 자동완성" })
    ).toBeVisible()
  })

  test("AI 자동완성 → 지시사항·체크리스트가 자동으로 채워진다 (Gemini 라이브 호출)", async ({
    page,
  }) => {
    test.setTimeout(60_000)
    const textarea = page.getByPlaceholder(
      "메시지 입력...  / 명령 · @ 사람 · # 업무"
    )
    await textarea.fill("/업무 라만 G-peak 분석 프로그램 검토 사원1 담당")
    await page.keyboard.press("Enter")

    const dialog = page.getByRole("dialog", { name: "업무 등록" })
    await expect(dialog).toBeVisible()
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/ai/structure-task") &&
        response.request().method() === "POST"
    )
    await dialog.getByRole("button", { name: /AI 자동완성/ }).click()
    const response = await responsePromise
    expect(response.ok()).toBe(true)
    const draft = await response.json()
    expect(draft._fallback, "실제 AI 응답이어야 함").not.toBe(true)
    expect(draft.checklist.length).toBeGreaterThan(0)

    const guideTextarea = dialog.getByRole("textbox", {
      name: "배경 / 지시사항",
    })
    await expect(guideTextarea).not.toHaveValue("", { timeout: 30_000 })
    await expect(
      dialog.getByRole("button", { name: "업무 등록", exact: true })
    ).toBeEnabled({
      timeout: 30_000,
    })
  })
})
