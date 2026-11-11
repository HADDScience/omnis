/**
 * AI 활용 설문 — 눌러서 답하고 · 중간에 나가도 이어지고 · 요약을 확인해 제출하면 관리자 화면에 잡힌다.
 * 계획: mydocs/plans/2026-11-11-ai-usage-survey.md
 *
 *   pnpm run test:e2e:local tests/feature/settings-ai-survey.spec.ts
 *
 * 설문은 허용한 계정에만 열린다 — CI · test:e2e:local 은 AI_SURVEY_ALLOW_USER_IDS="*" 로 전원에게 열고 돈다(허용 밖 404 는 lib/ai-survey/access.test.ts).
 * CI 는 시험 모델(OMNIS_AGENT_FAKE)이라 질문은 준비된 질문(lib/ai-survey/rules.ts fallbackAsk)으로 나온다 —
 * 말로 한 답도 모델 없이 규칙(guessSay)으로 읽는다. 폼으로 답하는 곳은 칸 종류(data-kind)만 보고 답한다. AI_SURVEY_SHOTS 에 절대 경로를 주면 화면을 남긴다.
 */
import path from "node:path"
import { expect, test, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { quickLogin } from "./_setup"

/**
 * 제출한 응답은 API 로 지울 수 없다(기록으로 남는다) — 다시 돌릴 때 「아직 안 한 사람」 으로 시작하려면 DB 에서 비운다.
 * 격리된 시험 DB(E2E_ISOLATED — CI · test:e2e:local)에서만. 데모 계정만
 */
async function clearSurveys(names: string[]) {
  if (process.env.E2E_ISOLATED !== "true") return
  const prisma = new PrismaClient()
  const users = await prisma.user.findMany({ where: { name: { in: names } }, select: { id: true } })
  await prisma.aiSurvey.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } })
  await prisma.$disconnect()
}

test.beforeAll(async () => {
  await clearSurveys(["사원1", "사원2"])
})

const shots = process.env.AI_SURVEY_SHOTS

/** 지금 질문의 칸을 종류대로 답하고 넘긴다. 범위 칸은 슬라이더 · 구간 칩으로, 말로 답하는 칸은 추천 답 칩으로 */
async function answerTurn(page: Page) {
  const turn = page.locator("[data-survey-turn]")
  const id = await turn.getAttribute("data-survey-turn")
  // 묶음 범위 질문은 한 번에 한 칸만 펼친다 — 펼친 칸을 답하고, 아직 안 고른 접힌 칸이 있으면 펼쳐서 또 답한다
  const done = new Set<string>()
  let n = 0
  let instant = false
  for (let guard = 0; guard < 6; guard++) {
    const fields = turn.locator("[data-survey-field]")
    const count = await fields.count()
    n = Math.max(n, count + (await turn.locator("[data-survey-field-summary]").count()))
    for (let i = 0; i < count; i++) {
      const f = fields.nth(i)
      const slot = (await f.getAttribute("data-slot-name"))!
      if (done.has(slot)) continue
      done.add(slot)
      const kind = await f.getAttribute("data-kind")
      if (kind === "single" || kind === "bucket") {
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
      } else {
        await turn.locator("[data-survey-input]").fill("시험 답")
      }
    }
    const left = turn.locator("[data-survey-field-summary]").filter({ hasText: "아직 안 골랐어요" })
    if ((await left.count()) === 0) break
    await left.first().click()
  }
  if (!instant) await turn.getByRole("button", { name: "보내기", exact: true }).click()
  // 다음 질문(또는 요약)이 뜰 때까지 — 기다리는 동안에는 폼이 없다
  await expect(page.locator(`[data-survey-turn]:not([data-survey-turn="${id}"]), [data-ai-survey="confirm"]`).first()).toBeVisible({ timeout: 30_000 })
}

test.describe("AI 활용 설문 @settings", () => {
  test.describe.configure({ mode: "serial" })

  // 지키는 것: 안 한 사람은 안내 띠 · 마이 화면 카드로 설문에 들어가 끝까지 답하고(숫자는 범위 입력, 나머지는 말이나 추천 답), 나갔다 와도 이어지며,
  //   지난 답을 그 자리에서 고치고, 요약을 확인해 제출하고, 제출한 뒤에는 요약을 다시 보거나 새로 할 수 있다(앞 응답은 기록으로 남는다)
  test("구성원 — 대화로 답하고 이어 하고 고치고 제출한다", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await quickLogin(page, "사원1")
    await page.request.delete("/api/ai-survey")
    // 아직 안 한 사람 — 들어오면 맨 위에 안내 띠, 마이 화면 로그아웃 아래에 「설문 참여하기」. 사용량 탭에는 설문 줄이 없다
    await page.context().clearCookies({ name: "omnis_survey_banner_dismissed" })
    await page.goto("/chat")
    const banner = page.locator("[data-survey-banner]")
    await expect(banner).toBeVisible({ timeout: 30_000 })
    await expect(banner.getByRole("link", { name: "설문 참여하기" })).toHaveAttribute("href", "/settings/ai-survey")
    // 닫으면 다시 들어와도 보이지 않는다(7일)
    await banner.getByRole("button", { name: /설문 안내 닫기/ }).click()
    await expect(banner).toHaveCount(0)
    await page.goto("/settings?tab=usage")
    await expect(page.locator("[data-ai-cost-usage]")).toBeVisible({ timeout: 30_000 })
    await expect(banner).toHaveCount(0)
    await expect(page.getByRole("link", { name: "설문 하기" })).toHaveCount(0)
    const card = page.locator("[data-ai-survey-entry]")
    await expect(card).toContainText("설문 참여하기")
    // 카드는 로그아웃 줄 아래에 있다
    const logoutY = (await page.getByRole("button", { name: "로그아웃" }).boundingBox())!.y
    expect((await card.boundingBox())!.y).toBeGreaterThan(logoutY)
    await card.click()
    await expect(page.locator('[data-ai-survey="intro"]')).toBeVisible({ timeout: 30_000 })
    // 설문 화면에는 안내 띠를 띄우지 않는다
    await page.context().clearCookies({ name: "omnis_survey_banner_dismissed" })
    await page.reload()
    await expect(page.locator('[data-ai-survey="intro"]')).toBeVisible({ timeout: 30_000 })
    await expect(banner).toHaveCount(0)
    await page.getByRole("button", { name: "시작하기" }).click()

    const turn = page.locator("[data-survey-turn]")
    const answers = page.locator("[data-survey-answer]")
    const input = page.locator("[data-survey-input]")
    await expect(turn).toBeVisible({ timeout: 30_000 })
    // 어느 칸이든 「잘 모르겠음」 이 있고, 답하기 전에는 보낼 수 없다
    await expect(turn.locator("[data-survey-unknown]").first()).toBeVisible()
    await expect(turn.getByRole("button", { name: "보내기", exact: true })).toBeDisabled()
    // 첫 질문은 주 사용 일수 — 일주일(0~7일)에서 고른다. 숫자를 글로 치는 칸이 없다
    const days0 = turn.locator('[data-slot-name="daysPerWeek"]')
    await expect(days0).toContainText("0일")
    await expect(days0).toContainText("7일")
    // 슬라이더 위에 지금 값이 뜬다
    const box0 = (await days0.locator("[data-slot=slider]").boundingBox())!
    await page.mouse.click(box0.x + box0.width * 0.6, box0.y + box0.height / 2)
    await expect(days0.locator("[data-survey-slider-value]")).toHaveText(/^\d일$/)
    // 펼친 칸은 늘 하나 — 묶음 질문(모델)의 다른 칸은 한 줄 요약으로 접힌다(준비된 질문은 칸이 하나다) · 아래 시트는 화면의 40% 를 넘지 않는다
    await expect(turn.locator("[data-survey-field]")).toHaveCount(1)
    const dockH = (await page.locator("[data-survey-dock]").boundingBox())!.height
    expect(dockH).toBeLessThanOrEqual(844 * 0.4 + 2)
    // 「처음부터 다시」 는 아래 시트가 아니라 위 ⋯ 메뉴에 있다
    await expect(page.locator("[data-survey-dock]").getByText("처음부터 다시")).toHaveCount(0)
    await page.locator("[data-survey-menu]").click()
    await expect(page.getByRole("menuitem", { name: "처음부터 다시" })).toBeVisible()
    await page.keyboard.press("Escape")
    await page.reload()
    await expect(turn).toBeVisible({ timeout: 30_000 })
    await expect(turn.locator("input[type=number]")).toHaveCount(0)
    // 폰에서 가로로 넘치지 않는다
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    if (shots) await page.screenshot({ path: path.join(shots, "ai-survey-turn-mobile.png") })

    await answerTurn(page)
    await answerTurn(page)
    // 중간에 나갔다 와도 지난 문답이 대화로 남고 묻던 질문이 그대로 있다
    const pending = await turn.getAttribute("data-survey-turn")
    await page.reload()
    await expect(page.locator(`[data-survey-turn="${pending}"]`)).toBeVisible({ timeout: 30_000 })
    await expect(answers).toHaveCount(2)
    expect(await page.locator('[data-survey-coverage] [data-purpose="usage"]').getAttribute("aria-valuenow")).not.toBe("0")

    // 말로 답한다 — 지금 질문(쓰는 도구)의 답으로 옮겨진다
    await input.fill("Claude")
    await turn.getByRole("button", { name: "보내기", exact: true }).click()
    await expect(answers).toHaveCount(3, { timeout: 30_000 })
    await expect(answers.nth(2)).toContainText("Claude")

    // 지난 답(범위 칸)을 누르면 그 질문만 다시 묻는다 — 대화는 그대로다
    const days = answers.first()
    const before = (await days.innerText()).trim()
    await days.locator("button").click()
    const editing = page.locator("[data-survey-editing]")
    await expect(editing).toContainText("고치는 중")
    const box = (await editing.locator("[data-slot=slider]").boundingBox())!
    await page.mouse.click(box.x + box.width * 0.15, box.y + box.height / 2)
    await editing.getByRole("button", { name: "보내기", exact: true }).click()
    await expect(days).toHaveAttribute("data-edited", "", { timeout: 30_000 })
    await expect(days.locator("[data-survey-edited]")).toHaveText("수정됨")
    await expect(days).toContainText(before.split("\n")[0])
    await expect(answers).toHaveCount(3)

    // 말로 고친다 — 범위 칸은 범위 입력을 그 값으로 맞춰 띄워 확정한다
    // 지금 질문이 범위 칸이면 입력창은 연필 단추 뒤에 접혀 있다
    if (!(await input.isVisible())) await page.locator("[data-survey-fix]").click()
    await input.fill("아까 며칠이라고 했는데 6일로 고쳐줘")
    await page.locator("[data-survey-turn]").getByRole("button", { name: "보내기", exact: true }).click()
    await expect(editing.locator("[data-survey-slider-value]")).toHaveText("6일", { timeout: 30_000 })
    await editing.getByRole("button", { name: "보내기", exact: true }).click()
    await expect(days).toContainText("6일", { timeout: 30_000 })
    await expect(answers).toHaveCount(3)
    await expect(editing).toHaveCount(0)

    for (let i = 0; i < 16 && (await page.locator('[data-ai-survey="confirm"]').count()) === 0; i++) await answerTurn(page)
    const confirm = page.locator('[data-ai-survey="confirm"]')
    await expect(confirm).toBeVisible({ timeout: 30_000 })
    for (const p of ["usage", "tasks", "wishes"]) await expect(confirm.locator(`[data-purpose="${p}"]`)).toHaveAttribute("aria-valuenow", "100")
    await expect(confirm.locator("[data-survey-summary]")).toContainText("주 6일")
    // 지표마다 근거 응답 번호가 붙는다
    await expect(confirm.locator("[data-survey-metrics]")).toContainText("근거")
    if (shots) await page.screenshot({ path: path.join(shots, "ai-survey-confirm-mobile.png"), fullPage: true })

    // 요약을 보다가 고친다 — 유료 → 무료면 월 금액 답은 쓰지 않게 되고 요약이 바뀐다
    const total = await answers.count()
    await answers.filter({ hasText: "회사가 냄" }).locator("button").click()
    await editing.locator("[data-survey-option]").first().click()
    await expect(confirm.locator("[data-survey-summary]")).toContainText("유료 구독은 없습니다", { timeout: 30_000 })
    await expect(page.locator("[data-survey-answer][data-dead]")).toHaveCount(1)
    await expect(answers).toHaveCount(total)

    await confirm.getByRole("button", { name: "맞아요, 제출" }).click()
    await expect(page.locator('[data-ai-survey="submitted"]')).toBeVisible({ timeout: 30_000 })
    const mine = (await (await page.request.get("/api/ai-survey")).json()) as { status: string; metrics: { monthlyTokens: number | null; daysPerWeek: number; payer: string } }
    expect(mine.status).toBe("SUBMITTED")
    expect(mine.metrics.monthlyTokens).not.toBeNull()
    expect(mine.metrics.daysPerWeek).toBe(6)
    expect(mine.metrics.payer).toBe("none")

    // 제출한 사람 — 안내 띠는 뜨지 않고(닫은 적이 없어도), 카드는 「설문 확인하기」. 들어가면 내 응답 요약이 보인다
    await page.context().clearCookies({ name: "omnis_survey_banner_dismissed" })
    await page.goto("/settings")
    await expect(card).toContainText("설문 확인하기", { timeout: 30_000 })
    await expect(banner).toHaveCount(0)
    await card.click()
    const submitted = page.locator('[data-ai-survey="submitted"]')
    await expect(submitted.locator("[data-survey-summary]")).toContainText("주 6일", { timeout: 30_000 })

    // 다시 하기 — 새 응답을 시작한다. 앞 응답은 지워지지 않고 기록으로 남는다
    await submitted.getByRole("button", { name: "다시 하기", exact: true }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "다시 하기", exact: true }).click()
    await expect(page.locator('[data-ai-survey="intro"]')).toBeVisible({ timeout: 30_000 })
    // 시작하기 전에 나가면 아무것도 바뀌지 않는다 — 여전히 제출한 응답이 내 응답이다
    expect(((await (await page.request.get("/api/ai-survey")).json()) as { status: string }).status).toBe("SUBMITTED")
    await page.getByRole("button", { name: "시작하기" }).click()
    await expect(turn).toBeVisible({ timeout: 30_000 })
    await answerTurn(page)
    const redo = (await (await page.request.get("/api/ai-survey")).json()) as { status: string; earlier: number; turns: unknown[] }
    expect(redo.status).toBe("IN_PROGRESS")
    expect(redo.earlier).toBe(1)
    await page.goto("/settings")
    await expect(card).toContainText("설문 이어서 하기", { timeout: 30_000 })
    // 다시 하다 그만두면(처음부터 다시) 답하던 것만 지워지고 앞서 제출한 응답으로 돌아간다
    expect((await page.request.delete("/api/ai-survey")).status()).toBe(200)
    const back = (await (await page.request.get("/api/ai-survey")).json()) as { status: string; earlier: number; metrics: { daysPerWeek: number } }
    expect(back.status).toBe("SUBMITTED")
    expect(back.earlier).toBe(0)
    expect(back.metrics.daysPerWeek).toBe(6)
    // 제출한 응답은 지우는 길이 없다
    expect((await page.request.delete("/api/ai-survey")).status()).toBe(200)
    expect(((await (await page.request.get("/api/ai-survey")).json()) as { status: string }).status).toBe("SUBMITTED")
  })

  // 지키는 것: 폼에 맞지 않는 응답 · 지금 질문이 아닌 응답 · 제출 뒤의 응답은 받지 않는다
  test("거부 — 폼에 없는 보기 · 지난 질문에 대한 응답 · 제출 뒤 응답", async ({ page }) => {
    await quickLogin(page, "사원2")
    await page.request.delete("/api/ai-survey")
    const events = async (data: object) => (await (await page.request.post("/api/ai-survey/turn", { data })).text()).trim().split("\n").map((l) => JSON.parse(l) as { t: string; status?: number; turnId?: string; num?: number | null; state?: { turns: { id: string; ask: { fields: { id: string }[] } }[] } })
    const first = (await events({})).at(-1)!.state!.turns[0]
    const f = first.ask.fields[0].id

    expect((await events({ answer: { turnId: first.id, values: { [f]: { choice: ["없는보기"] } } } })).at(-1)).toMatchObject({ t: "error", status: 400 })
    expect((await events({ answer: { turnId: first.id, values: { [f]: { num: 9999 } } } })).at(-1)).toMatchObject({ t: "error", status: 400 })
    expect((await events({ answer: { turnId: first.id, values: {} } })).at(-1)).toMatchObject({ t: "error", status: 400 })
    expect((await events({ answer: { turnId: "다른-질문", values: { [f]: { unknown: true } } } })).at(-1)).toMatchObject({ t: "error", status: 409 })
    // 일주일은 7일까지 · 말로 한 답은 서버만 만든다 · 없는 질문은 고칠 수 없다 · 한 번에 하나만
    expect((await events({ answer: { turnId: first.id, values: { [f]: { num: 8 } } } })).at(-1)).toMatchObject({ t: "error", status: 400 })
    expect((await events({ answer: { turnId: first.id, values: { [f]: { said: "3일", labels: ["3일"] } } } })).at(-1)).toMatchObject({ t: "error", status: 400 })
    expect((await events({ edit: { turnId: first.id, values: { [f]: { num: 3 } } } })).at(-1)).toMatchObject({ t: "error", status: 400 })
    expect((await events({ say: { text: "3일", turnId: "없는-질문" } })).at(-1)).toMatchObject({ t: "error", status: 400 })
    expect((await page.request.post("/api/ai-survey/turn", { data: { say: { text: "" } } })).status()).toBe(400)
    expect((await page.request.post("/api/ai-survey/turn", { data: { say: { text: "3일" }, answer: { turnId: first.id, values: {} } } })).status()).toBe(400)
    // 범위 칸은 글로 확정되지 않는다 — 숫자를 말해도 답이 저장되지 않고 범위 입력을 띄우라는 답만 온다
    const said = await events({ say: { text: "3일" } })
    expect(said.find((e) => e.t === "range")).toMatchObject({ turnId: first.id, num: 3 })
    expect((said.at(-1)!.state!.turns[0] as { answer?: object }).answer).toBeUndefined()
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
    // 제출한 뒤에는 「다시 하기」 라고 해야만 새 응답이 시작된다
    expect((await events({})).at(-1)).toMatchObject({ t: "error", status: 409 })
    expect((await events({ restart: true })).at(-1)!.state).toMatchObject({ status: "IN_PROGRESS" })
    await page.request.delete("/api/ai-survey")
  })

  // 지키는 것: 회사 전체 추정과 개인 원문은 관리자만 보고, 구성원은 남의 설문을 볼 길이 없다
  test("관리자만 결과를 본다 — 회사 전체 추정 · 사람별 원문 · 대기 시간", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await quickLogin(page, "사원2")
    await page.goto("/settings/ai-survey/results")
    await expect(page.getByText("관리자만 볼 수 있습니다")).toBeVisible({ timeout: 30_000 })
    await expect(page.locator("[data-survey-results]")).toHaveCount(0)
    await page.goto("/settings?tab=info")
    await expect(page.locator("[data-ai-survey-entry]")).toBeVisible({ timeout: 30_000 })
    await expect(page.locator("[data-ai-survey-results-link]")).toHaveCount(0)

    await page.context().clearCookies()
    await quickLogin(page, "팀장")
    await page.goto("/settings?tab=info")
    await page.locator("[data-ai-survey-results-link]").click()
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
