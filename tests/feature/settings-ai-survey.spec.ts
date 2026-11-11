/**
 * AI 활용 설문 — 눌러서 답하고 · 중간에 나가도 이어지고 · 요약을 확인해 제출하면 관리자 화면에 잡힌다.
 * 계획: mydocs/plans/2026-11-11-ai-usage-survey.md
 *
 *   pnpm run test:e2e:local tests/feature/settings-ai-survey.spec.ts
 *
 * 설문은 허용한 계정에만 열린다 — CI · test:e2e:local 은 AI_SURVEY_ALLOW_USER_IDS="*" 로 전원에게 열고 돈다(허용 밖 404 는 lib/ai-survey/access.test.ts).
 * CI 는 시험 모델(OMNIS_AGENT_FAKE)이라 질문은 준비된 질문(lib/ai-survey/rules.ts fallbackAsk)으로 나온다 —
 * 모델이 만든 질문이어도 통과하도록 칸 종류(data-kind)만 보고 답한다. AI_SURVEY_SHOTS 에 절대 경로를 주면 화면을 남긴다.
 */
import path from "node:path"
import { expect, test, type Page } from "@playwright/test"
import { quickLogin } from "./_setup"

const shots = process.env.AI_SURVEY_SHOTS

/** 지금 질문의 칸을 종류대로 답하고 넘긴다. 슬라이더는 가운데를 누른다 */
async function answerTurn(page: Page) {
  const turn = page.locator("[data-survey-turn]")
  const id = await turn.getAttribute("data-survey-turn")
  const fields = turn.locator("[data-survey-field]")
  const n = await fields.count()
  let instant = false
  for (let i = 0; i < n; i++) {
    const f = fields.nth(i)
    const kind = await f.getAttribute("data-kind")
    if (kind === "single") {
      instant = n === 1
      await f.locator("[data-survey-option]").nth(1).click()
    } else if (kind === "multi") {
      await f.locator("[data-survey-option]").nth(0).click()
      await f.locator("[data-survey-option]").nth(1).click()
    } else if (kind === "slider") {
      const box = (await f.locator("[data-slot=slider]").boundingBox())!
      await page.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2)
    } else if (kind === "scale") {
      await f.locator("[data-survey-scale='4']").click()
    } else if (kind === "number") {
      await f.locator("input").fill("30000")
    } else {
      await f.locator("input").fill("시험 답")
    }
  }
  if (!instant) await turn.getByRole("button", { name: "보내기", exact: true }).click()
  // 다음 질문(또는 요약)이 뜰 때까지 — 기다리는 동안에는 폼이 없다
  await expect(page.locator(`[data-survey-turn]:not([data-survey-turn="${id}"]), [data-ai-survey="confirm"]`).first()).toBeVisible({ timeout: 30_000 })
}

test.describe("AI 활용 설문 @settings", () => {
  test.describe.configure({ mode: "serial" })

  // 지키는 것: 설문을 눌러서 끝까지 답하고, 중간에 나갔다 와도 답하던 곳에서 이어지며, 요약을 확인해 제출할 수 있다
  test("구성원 — 눌러서 답하고 이어 하고 제출한다", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await quickLogin(page, "사원1")
    await page.request.delete("/api/ai-survey")
    await page.goto("/settings?tab=usage")
    await page.locator("[data-ai-survey-entry]").getByRole("link", { name: "설문 하기" }).click()
    await expect(page.locator('[data-ai-survey="intro"]')).toBeVisible({ timeout: 30_000 })
    await page.getByRole("button", { name: "시작하기" }).click()

    const turn = page.locator("[data-survey-turn]")
    await expect(turn).toBeVisible({ timeout: 30_000 })
    // 어느 칸이든 「잘 모르겠음」 이 있고, 답하기 전에는 넘어갈 수 없다
    await expect(turn.locator("[data-survey-unknown]").first()).toBeVisible()
    await expect(turn.getByRole("button", { name: "보내기", exact: true })).toBeDisabled()
    // 폰에서 가로로 넘치지 않는다
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    if (shots) await page.screenshot({ path: path.join(shots, "ai-survey-turn-mobile.png") })

    await answerTurn(page)
    await answerTurn(page)
    // 중간에 나갔다 와도 지난 답이 남고 묻던 질문이 그대로 있다
    const pending = await turn.getAttribute("data-survey-turn")
    await page.reload()
    await expect(page.locator(`[data-survey-turn="${pending}"]`)).toBeVisible({ timeout: 30_000 })
    // 지난 문답이 대화로 남아 있다 — 옴니스의 질문과 내 답 말풍선
    await expect(page.locator("[data-survey-answer]")).toHaveCount(2)
    expect(await page.locator('[data-survey-coverage] [data-purpose="usage"]').getAttribute("aria-valuenow")).not.toBe("0")

    // 지난 답을 누르면 그 질문으로 돌아가 다시 답한다 — 그 뒤 답은 지워진다
    await page.locator("[data-survey-answer] button").first().click()
    await page.locator("[data-survey-edit-confirm]").getByRole("button", { name: "고치기", exact: true }).click()
    await expect(page.locator("[data-survey-answer]")).toHaveCount(0)
    await expect(turn).toBeVisible()
    // 확인 창이 닫히는 동안에는 그 뒤 화면을 누를 수 없다
    await expect(page.locator("[data-survey-edit-confirm]")).toHaveCount(0)

    for (let i = 0; i < 16 && (await turn.count()) > 0; i++) await answerTurn(page)
    const confirm = page.locator('[data-ai-survey="confirm"]')
    await expect(confirm).toBeVisible({ timeout: 30_000 })
    for (const p of ["usage", "tasks", "wishes"]) await expect(confirm.locator(`[data-purpose="${p}"]`)).toHaveAttribute("aria-valuenow", "100")
    await expect(confirm.locator("[data-survey-summary]")).not.toBeEmpty()
    // 지표마다 근거 응답 번호가 붙는다
    await expect(confirm.locator("[data-survey-metrics]")).toContainText("근거")
    if (shots) await page.screenshot({ path: path.join(shots, "ai-survey-confirm-mobile.png"), fullPage: true })

    await confirm.getByRole("button", { name: "맞아요, 제출" }).click()
    await expect(page.locator('[data-ai-survey="submitted"]')).toBeVisible({ timeout: 30_000 })
    const mine = (await (await page.request.get("/api/ai-survey")).json()) as { status: string; metrics: { monthlyTokens: number | null } }
    expect(mine.status).toBe("SUBMITTED")
    expect(mine.metrics.monthlyTokens).not.toBeNull()
  })

  // 지키는 것: 폼에 맞지 않는 응답 · 지금 질문이 아닌 응답 · 제출 뒤의 응답은 받지 않는다
  test("거부 — 폼에 없는 보기 · 지난 질문에 대한 응답 · 제출 뒤 응답", async ({ page }) => {
    await quickLogin(page, "사원2")
    await page.request.delete("/api/ai-survey")
    const events = async (data: object) => (await (await page.request.post("/api/ai-survey/turn", { data })).text()).trim().split("\n").map((l) => JSON.parse(l) as { t: string; status?: number; state?: { turns: { id: string; ask: { fields: { id: string }[] } }[] } })
    const first = (await events({})).at(-1)!.state!.turns[0]
    const f = first.ask.fields[0].id

    expect((await events({ answer: { turnId: first.id, values: { [f]: { choice: ["없는보기"] } } } })).at(-1)).toMatchObject({ t: "error", status: 400 })
    expect((await events({ answer: { turnId: first.id, values: { [f]: { num: 9999 } } } })).at(-1)).toMatchObject({ t: "error", status: 400 })
    expect((await events({ answer: { turnId: first.id, values: {} } })).at(-1)).toMatchObject({ t: "error", status: 400 })
    expect((await events({ answer: { turnId: "다른-질문", values: { [f]: { unknown: true } } } })).at(-1)).toMatchObject({ t: "error", status: 409 })
    // 아직 답하지 않은 질문이 있으면 제출할 수 없다
    expect((await page.request.post("/api/ai-survey/submit")).status()).toBe(409)

    // 「잘 모르겠음」 만으로도 끝까지 갈 수 있다 — 같은 질문을 되풀이하지 않는다
    let state = (await events({ answer: { turnId: first.id, values: { [f]: { unknown: true } } } })).at(-1)!.state as { status: string; turns: { id: string; answer?: object; ask: { fields: { id: string }[] } }[] }
    for (let i = 0; i < 16 && state.status === "IN_PROGRESS"; i++) {
      const last = state.turns.at(-1)!
      state = (await events({ answer: { turnId: last.id, values: Object.fromEntries(last.ask.fields.map((x) => [x.id, { unknown: true }])) } })).at(-1)!.state as typeof state
    }
    expect(state.status).toBe("CONFIRM")
    expect((await page.request.post("/api/ai-survey/submit")).status()).toBe(200)
    expect((await events({})).at(-1)).toMatchObject({ t: "error", status: 409 })
    await page.request.delete("/api/ai-survey")
  })

  // 지키는 것: 회사 전체 추정과 개인 원문은 관리자만 보고, 구성원은 남의 설문을 볼 길이 없다
  test("관리자만 결과를 본다 — 회사 전체 추정 · 사람별 원문 · 대기 시간", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await quickLogin(page, "사원2")
    await page.goto("/settings/ai-survey/results")
    await expect(page.getByText("관리자만 볼 수 있습니다")).toBeVisible({ timeout: 30_000 })
    await expect(page.locator("[data-survey-results]")).toHaveCount(0)
    await page.goto("/settings?tab=usage")
    await expect(page.locator("[data-ai-survey-entry]")).toBeVisible({ timeout: 30_000 })
    await expect(page.locator("[data-ai-survey-entry]").getByRole("link", { name: "결과 보기" })).toHaveCount(0)

    await page.context().clearCookies()
    await quickLogin(page, "팀장")
    await page.goto("/settings?tab=usage")
    await page.locator("[data-ai-survey-entry]").getByRole("link", { name: "결과 보기" }).click()
    const results = page.locator("[data-survey-results]")
    await expect(results).toBeVisible({ timeout: 30_000 })
    // 앞 시험에서 사원1 이 제출했다
    await expect(results.locator("[data-survey-company]")).toContainText("월 토큰(응답자 합)")
    await expect(results.locator("[data-survey-company]")).toContainText("옴니스 API 환산")
    await expect(results.locator("[data-survey-company]")).toContainText("시작 전")
    if (shots) await page.screenshot({ path: path.join(shots, "ai-survey-results-pc.png"), fullPage: true })

    await results.getByRole("tab", { name: "사람별" }).click()
    const person = results.locator("[data-survey-person]").filter({ hasText: "사원1" })
    await expect(person).toContainText("제출")
    await person.locator("summary").click()
    await expect(person).toContainText("원문 — 질문 · 제시한 보기 · 응답")
    await expect(person.locator("[data-survey-metrics]")).toContainText("근거")

    await results.getByRole("tab", { name: "대기 · 비용" }).click()
    await expect(results.locator("[data-survey-latency]")).toContainText("첫 질문")
  })
})
