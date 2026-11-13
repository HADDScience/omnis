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
import { randomUUID } from "node:crypto"
import path from "node:path"
import { expect, test, type Page } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import { lastWeekLabel, normalizeAsk, type Facts, type RawField } from "../../lib/ai-survey/rules"
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

/**
 * 묶음 범위 질문(모델이 내는 모양)을 첫 질문으로 둔 응답을 만든다 — CI 는 시험 모델이라 준비된 질문(칸 하나)만 나온다.
 * 칸은 서버와 같은 규칙(normalizeAsk)으로 만든다. 격리된 시험 DB 에서만
 */
async function seedGrouped(name: string, question: string, fields: RawField[]) {
  const ask = normalizeAsk({ question, fields }, {})
  if (!ask || ask.fields.length !== fields.length) throw new Error("묶음 질문을 만들지 못했다")
  const prisma = new PrismaClient()
  const user = await prisma.user.findFirstOrThrow({ where: { name }, select: { id: true } })
  await prisma.aiSurvey.deleteMany({ where: { userId: user.id } })
  const turns = [{ id: randomUUID(), ask, askedAt: new Date().toISOString(), source: "model", ms: { first: null, total: 0 } }]
  // Json 칸 — 서버(service.ts json())처럼 평범한 JSON 으로 넣는다
  await prisma.aiSurvey.create({ data: { userId: user.id, turns: JSON.parse(JSON.stringify(turns)) } })
  await prisma.$disconnect()
  return ask
}

/** 지금 질문의 칸을 종류대로 답하고 넘긴다. 범위 칸은 슬라이더 · 구간 칩으로, 말로 답하는 칸은 추천 답 칩으로 */
async function answerTurn(page: Page) {
  const turn = page.locator("[data-survey-turn]")
  const id = await turn.getAttribute("data-survey-turn")
  // 묶음 범위 질문은 한 번에 한 칸만 보인다 — 보이는 칸을 답하고 「다음」 으로 넘어간다(저절로 넘어가지 않는다)
  const done = new Set<string>()
  const grouped = (await turn.locator("[data-survey-step-count]").count()) > 0
  let instant = false
  for (let guard = 0; guard < 6; guard++) {
    const fields = turn.locator("[data-survey-field]")
    const count = await fields.count()
    const n = grouped ? 2 : count
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
    const next = turn.locator("[data-survey-step-next]")
    if ((await next.count()) === 0) break
    await next.click()
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
    // 질문 열댓 개를 끝까지 답한다 — 로컬 dev 서버에서 main 도 56초(기본 한도 60초)라 한도에 걸려 떨어졌다(2026-11-12)
    test.setTimeout(120_000)
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
    // 목적 문구 — 「예산」 을 말하지 않고, 개인 평가와 상관없고 합계만 보인다고 말한다(답을 부풀리거나 줄이지 않게)
    const intro = page.locator("[data-survey-intro]")
    await expect(intro.locator("[data-survey-purpose]")).toHaveText("옴니스가 어떤 일을 도와야 할지 정하는 데 씁니다. 개인 평가와 상관없고, 회사에는 전체 합계만 보입니다. 정확히 모르면 『잘 모르겠음』을 골라도 됩니다.")
    await expect(intro).not.toContainText("예산")
    if (shots) await page.screenshot({ path: path.join(shots, "01-intro-light.png") })
    await page.getByRole("button", { name: "시작하기" }).click()

    const turn = page.locator("[data-survey-turn]")
    const answers = page.locator("[data-survey-answer]")
    const input = page.locator("[data-survey-input]")
    await expect(turn).toBeVisible({ timeout: 30_000 })
    // 어느 칸이든 「잘 모르겠음」 이 있고, 답하기 전에는 보낼 수 없다
    await expect(turn.locator("[data-survey-unknown]").first()).toBeVisible()
    await expect(turn.getByRole("button", { name: "보내기", exact: true })).toBeDisabled()
    // 첫 질문은 지난주 사용 일수 — 「평소」 가 아니라 지난주(월~일), 날짜가 괄호에. 일주일(0~7일)에서 고른다. 숫자를 글로 치는 칸이 없다
    await expect(page.locator("[data-survey-question]")).toContainText(lastWeekLabel())
    await expect(page.locator("[data-survey-question]")).toContainText("지난주(")
    await expect(page.locator("[data-survey-question]")).not.toContainText("평소")
    const days0 = turn.locator('[data-slot-name="daysPerWeek"]')
    await expect(days0).toContainText("0일")
    await expect(days0).toContainText("7일")
    // 슬라이더 위에 지금 값이 뜬다
    const box0 = (await days0.locator("[data-slot=slider]").boundingBox())!
    await page.mouse.click(box0.x + box0.width * 0.6, box0.y + box0.height / 2)
    await expect(days0.locator("[data-survey-slider-value]")).toHaveText(/^\d일$/)
    // 칸이 하나인 질문(준비된 질문)은 단계 표시 · 이전 · 다음이 없다 — 고르고 보낸다 · 아래 시트는 화면의 40% 를 넘지 않는다
    await expect(turn.locator("[data-survey-field]")).toHaveCount(1)
    await expect(turn.locator("[data-survey-step-count], [data-survey-step-next], [data-survey-step-prev]")).toHaveCount(0)
    await expect(turn.getByRole("button", { name: "보내기", exact: true })).toBeEnabled()
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

    for (let i = 0; i < 20 && (await page.locator('[data-ai-survey="confirm"]').count()) === 0; i++) {
      // 가장 최근에 맡긴 일 — 기억 안 남 · 기타까지 칩으로 있다
      const recent = page.locator('[data-survey-turn] [data-slot-name="recentTask"]')
      if ((await recent.count()) > 0) {
        await expect(recent.locator("[data-survey-option]")).toHaveText(["메일 초안", "문서 요약", "표 정리", "번역", "코드", "기억 안 남", "기타"])
        if (shots) await page.screenshot({ path: path.join(shots, "02-recent-task-light.png") })
      }
      await answerTurn(page)
    }
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

  // 지키는 것: 폰에서 「고칠 답 말하기」 를 누르면 시트가 키보드 바로 위에 붙고 하단 nav 는 숨는다. 키보드가 닫히면 돌아오고, 시트 아래에 빈 자리가 없다
  test("폰 — 키보드가 열리면 시트가 키보드 바로 위에 붙는다 @mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    // 시험 브라우저에는 화면 키보드가 없다 — visualViewport 를 모의한다(tests/feature/mobile-keyboard.spec.ts 와 같은 방법)
    await page.addInitScript(() => {
      const fake = new EventTarget() as EventTarget & Record<string, unknown>
      let height: number | null = null
      Object.defineProperties(fake, {
        height: { get: () => height ?? window.innerHeight },
        width: { get: () => window.innerWidth },
        scale: { value: 1 },
        offsetTop: { value: 0 },
        offsetLeft: { value: 0 },
      })
      Object.defineProperty(window, "visualViewport", { value: fake, configurable: true })
      ;(window as unknown as { __keyboard: (h: number | null) => void }).__keyboard = (h) => {
        height = h
        fake.dispatchEvent(new Event("resize"))
      }
    })
    const keyboard = (top: number | null) => page.evaluate((h) => (window as unknown as { __keyboard: (h: number | null) => void }).__keyboard(h), top)
    const dock = page.locator("[data-survey-dock]")
    const nav = page.locator('nav[aria-label="주 메뉴"]').last()
    const navTop = () => nav.evaluate((el) => (getComputedStyle(el).display === "none" ? Infinity : el.getBoundingClientRect().top))

    await quickLogin(page, "사원2")
    await page.request.delete("/api/ai-survey")
    await page.goto("/settings/ai-survey")
    await page.getByRole("button", { name: "시작하기" }).click()
    await expect(page.locator("[data-survey-turn]")).toBeVisible({ timeout: 30_000 })

    // 키보드 없음 — 시트는 하단 nav 바로 위에 있고 그 사이가 크게 비지 않는다
    await expect.poll(async () => (await navTop()) - (await dock.boundingBox())!.y - (await dock.boundingBox())!.height).toBeLessThan(32)
    expect((await navTop()) - ((await dock.boundingBox())!.y + (await dock.boundingBox())!.height)).toBeGreaterThanOrEqual(0)

    // 마지막 질문은 시트 위에 다 보인다 — 칩이 여러 줄인 질문(말로 답하는 질문)까지 넘어가며 매번 본다
    const lastQuestionClear = async () => {
      const q = (await page.locator("[data-survey-question]").last().boundingBox())!
      return Math.round((await dock.boundingBox())!.y - (q.y + q.height))
    }
    await expect.poll(lastQuestionClear).toBeGreaterThanOrEqual(0)
    for (let i = 0; i < 4; i++) {
      await answerTurn(page)
      await expect.poll(lastQuestionClear, { timeout: 10_000 }).toBeGreaterThanOrEqual(0)
      if ((await page.locator("[data-survey-turn] [data-kind='multi']").count()) > 0) break
    }
    // 칩이 여러 줄인 질문에서 확인했다
    expect(await page.locator("[data-survey-turn] [data-kind='multi'] [data-survey-option]").count()).toBeGreaterThan(3)
    expect(await lastQuestionClear()).toBeGreaterThanOrEqual(0)

    // 범위 질문이면 연필로 입력창을 연다(말로 답하는 질문은 늘 열려 있다)
    const input = page.locator("[data-survey-input]")
    if (!(await input.isVisible())) await page.locator("[data-survey-fix]").click()
    await input.focus()
    await keyboard(450)
    await expect.poll(() => page.evaluate(() => document.documentElement.hasAttribute("data-keyboard-docked"))).toBe(true)
    // 시트 아래 = 키보드 위(6px 여백만), 하단 nav 는 화면 밖
    await expect.poll(async () => { const b = (await dock.boundingBox())!; return Math.round(450 - (b.y + b.height)) }).toBeLessThanOrEqual(12)
    expect(Math.round(450 - ((await dock.boundingBox())!.y + (await dock.boundingBox())!.height))).toBeGreaterThanOrEqual(0)
    await expect.poll(async () => (await navTop()) >= 450).toBe(true)

    // 키보드를 닫으면 원래대로
    await input.blur()
    await keyboard(null)
    await expect.poll(() => page.evaluate(() => document.documentElement.hasAttribute("data-keyboard-docked"))).toBe(false)
    await expect.poll(async () => (await navTop()) < 844).toBe(true)
    await page.request.delete("/api/ai-survey")
  })

  // 지키는 것: 한 질문에 범위 칸이 둘이면 한 칸씩 보이고, 슬라이더 · 칩을 만져도 저절로 넘어가지 않는다.
  //   시트 아래 「이전」 · 「다음」 으로 오가고(돌아가면 고른 값이 그대로), 마지막 칸은 「보내기」. 1 / 2 표시가 있다. 라이트 · 다크
  for (const theme of ["light", "dark"] as const) {
    test(`묶음 질문 — 이전 · 다음으로 칸을 오가고 마지막 칸에서 보낸다 (${theme}) @mobile`, async ({ page }) => {
      test.skip(process.env.E2E_ISOLATED !== "true", "시험 DB 에 질문을 직접 넣는다 — 격리된 DB 에서만")
      await page.setViewportSize({ width: 390, height: 844 })
      if (theme === "dark") await page.addInitScript(() => localStorage.setItem("theme", "dark"))
      await quickLogin(page, "사원2")
      const turn = page.locator("[data-survey-turn]")
      const count = turn.locator("[data-survey-step-count]")
      const prev = turn.getByRole("button", { name: "이전", exact: true })
      const next = turn.getByRole("button", { name: "다음", exact: true })
      const send = turn.getByRole("button", { name: "보내기", exact: true })
      const dock = page.locator("[data-survey-dock]")
      const slide = async (at: number) => {
        const box = (await turn.locator("[data-slot=slider]").boundingBox())!
        await page.mouse.click(box.x + box.width * at, box.y + box.height / 2)
      }
      const shot = async (name: string) => { if (shots) await page.screenshot({ path: path.join(shots, `${name}-${theme}.png`) }) }

      // ① 슬라이더 두 칸 — 일주일 중 쓰는 날 수 · 쓰는 날 하루 사용 시간
      await seedGrouped("사원2", "일주일에 며칠, 쓰는 날에는 하루에 얼마나 AI 를 쓰세요?", [
        { slot: "daysPerWeek", label: "일주일 중 쓰는 날 수" },
        { slot: "hoursPerDay", label: "쓰는 날 하루 사용 시간" },
      ])
      await page.goto("/settings/ai-survey")
      await expect(turn).toBeVisible({ timeout: 30_000 })
      await expect(count).toHaveText("1 / 2")
      await expect(turn.locator("[data-survey-field]")).toHaveCount(1)
      await expect(prev).toHaveCount(0)
      await expect(next).toBeDisabled()
      await shot("01-step1-empty")
      await slide(0.6)
      const days = (await turn.locator("[data-survey-slider-value]").innerText()).trim()
      expect(days).toMatch(/^\d일$/)
      // 손을 떼도 넘어가지 않는다
      await page.waitForTimeout(600)
      await expect(count).toHaveText("1 / 2")
      await expect(next).toBeEnabled()
      await shot("02-step1-picked")
      await next.click()
      await expect(count).toHaveText("2 / 2")
      await expect(turn.locator('[data-slot-name="hoursPerDay"]')).toBeVisible()
      await expect(next).toHaveCount(0)
      await expect(prev).toBeVisible()
      await expect(send).toBeDisabled()
      await slide(0.3)
      const hours = (await turn.locator("[data-survey-slider-value]").innerText()).trim()
      expect(hours).toMatch(/시간$/)
      await page.waitForTimeout(600)
      await expect(count).toHaveText("2 / 2")
      await expect(send).toBeEnabled()
      await shot("03-step2-picked")
      // 이전 — 앞에서 고른 값이 그대로 보인다. 다시 다음 — 뒤 칸 값도 그대로
      await prev.click()
      await expect(count).toHaveText("1 / 2")
      await expect(turn.locator("[data-survey-slider-value]")).toHaveText(days)
      await expect(next).toBeEnabled()
      await next.click()
      await expect(turn.locator("[data-survey-slider-value]")).toHaveText(hours)
      // 시트는 화면의 40% 를 넘지 않고, 질문은 시트 위에 다 보이며, 가로로 넘치지 않는다
      expect((await dock.boundingBox())!.height).toBeLessThanOrEqual(844 * 0.4 + 2)
      const q = (await page.locator("[data-survey-question]").boundingBox())!
      expect(Math.round((await dock.boundingBox())!.y - (q.y + q.height))).toBeGreaterThanOrEqual(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await send.click()
      const answer = page.locator("[data-survey-answer]")
      await expect(answer).toHaveCount(1, { timeout: 30_000 })
      await expect(answer).toContainText(`일주일 중 쓰는 날 수: ${days}`)
      await expect(answer).toContainText(`쓰는 날 하루 사용 시간: ${hours}`)

      // ② 슬라이더 + 칩 하나 고르는 칸(하루에 묻는 횟수) — 칩을 눌러도 바로 보내지 않는다
      await seedGrouped("사원2", "일주일에 며칠, 쓰는 날에는 몇 번쯤 물어보세요?", [
        { slot: "daysPerWeek", label: "일주일 중 쓰는 날 수" },
        { slot: "sessionsPerDay", label: "쓰는 날 하루에 묻는 횟수" },
      ])
      await page.goto("/settings/ai-survey")
      await expect(count).toHaveText("1 / 2", { timeout: 30_000 })
      await slide(0.6)
      await next.click()
      await expect(count).toHaveText("2 / 2")
      const chip = turn.locator("[data-survey-option]").nth(1)
      const label = (await chip.innerText()).trim()
      await chip.click()
      await expect(chip).toHaveAttribute("aria-pressed", "true")
      await page.waitForTimeout(600)
      await expect(page.locator("[data-survey-answer]")).toHaveCount(0)
      await expect(count).toHaveText("2 / 2")
      await shot("04-chip-picked")
      // 이전으로 가도 칩 값이 남는다
      await prev.click()
      await next.click()
      await expect(turn.locator("[data-survey-option]").nth(1)).toHaveAttribute("aria-pressed", "true")
      await send.click()
      await expect(page.locator("[data-survey-answer]")).toContainText(`쓰는 날 하루에 묻는 횟수: ${label}`, { timeout: 30_000 })
      await page.request.delete("/api/ai-survey")
    })
  }

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
    for (let i = 0; i < 20 && state.status === "IN_PROGRESS"; i++) {
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

  // 지키는 것: 앞뒤가 안 맞는 답(지난주 0일인데 가장 최근 일이 지난주)은 요약 확인에서 「이 부분 고칠까요?」 로 한 번 묻는다.
  //   고칠 답으로 바로 가고, 「이대로 둘게요」 로 닫아도 제출할 수 있다(강제 아님). 라이트 · 다크
  for (const theme of ["light", "dark"] as const) {
    test(`앞뒤가 안 맞는 답 — 제출 전 요약에서 한 번 묻는다 (${theme})`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      if (theme === "dark") await page.addInitScript(() => localStorage.setItem("theme", "dark"))
      await quickLogin(page, "사원3")
      await page.request.delete("/api/ai-survey")
      type St = { status: string; turns: { id: string; answer?: object; ask: { fields: { id: string; slot: string; options?: { id: string; label: string }[] }[] } }[] }
      const step = async (data: object) => (await (await page.request.post("/api/ai-survey/turn", { data })).text()).trim().split("\n").map((l) => JSON.parse(l) as { t: string; state?: St }).at(-1)!.state!
      // 지난주 0일 → 가장 최근 일(메일 초안) → 언제: 지난주 → 나머지는 잘 모르겠음
      let st = await step({})
      for (let i = 0; i < 12 && st.status === "IN_PROGRESS"; i++) {
        const last = st.turns.at(-1)!
        const values = Object.fromEntries(last.ask.fields.map((x) => {
          if (x.slot === "daysPerWeek") return [x.id, { num: 0 }]
          if (x.slot === "recentTask") return [x.id, { choice: [x.options!.find((o) => o.label === "메일 초안")!.id] }]
          if (x.slot === "recentWhen") return [x.id, { choice: [x.options!.find((o) => o.label.startsWith("지난주"))!.id] }]
          return [x.id, { unknown: true }]
        }))
        st = await step({ answer: { turnId: last.id, values } })
      }
      expect(st.status).toBe("CONFIRM")

      await page.goto("/settings/ai-survey")
      const confirm = page.locator('[data-ai-survey="confirm"]')
      const check = confirm.locator("[data-survey-check]")
      await expect(check).toBeVisible({ timeout: 30_000 })
      await expect(check).toContainText("이 부분 고칠까요?")
      await expect(check.locator('[data-survey-flag="zero-days-recent"]')).toContainText("지난주에 쓴 날이 0일인데, 가장 최근 일은 지난주였다고 하셨어요.")
      // 고칠 답으로 바로 간다 — 1번(쓴 날 수) · 3번(언제)
      await expect(check.getByRole("button", { name: "1번 답 고치기" })).toBeVisible()
      await expect(check.getByRole("button", { name: "3번 답 고치기" })).toBeVisible()
      await check.scrollIntoViewIfNeeded()
      if (shots) await page.screenshot({ path: path.join(shots, `03-check-${theme}.png`) })
      await check.getByRole("button", { name: "3번 답 고치기" }).click()
      await expect(page.locator("[data-survey-editing]")).toContainText("그 일은 언제였나요?")
      await page.locator("[data-survey-editing]").getByRole("button", { name: "취소" }).click()
      // 강제가 아니다 — 닫으면 다시 묻지 않고, 그대로 제출할 수 있다
      await check.getByRole("button", { name: "이대로 둘게요" }).click()
      await expect(check).toHaveCount(0)
      await expect(confirm.getByRole("button", { name: "맞아요, 제출" })).toBeEnabled()
      await page.request.delete("/api/ai-survey")
    })
  }

  // 지키는 것: 관리자에게도 합계만 — 이름 · 사람별 원문 · 사람별 지표는 화면에도 API 에도 없다. 응답 3명 미만이면 합계도 숨긴다.
  //   앞뒤가 안 맞는 응답은 「확인 필요」 로 따로 센다. 구성원은 결과 화면 · API 를 볼 수 없다
  test("관리자 결과 — 합계만, 3명 미만이면 숨김, 확인 필요는 따로, API 도 원문 없음", async ({ page }) => {
    test.skip(process.env.E2E_ISOLATED !== "true", "시험 DB 에 응답을 직접 넣는다 — 격리된 DB 에서만")
    await page.setViewportSize({ width: 390, height: 844 })
    await quickLogin(page, "사원2")
    await page.goto("/settings/ai-survey/results")
    await expect(page.getByText("관리자만 볼 수 있습니다")).toBeVisible({ timeout: 30_000 })
    await expect(page.locator("[data-survey-results]")).toHaveCount(0)
    expect((await page.request.get("/api/ai-survey/results")).status()).toBe(403)
    await page.goto("/settings?tab=info")
    await expect(page.locator("[data-ai-survey-entry]")).toBeVisible({ timeout: 30_000 })
    await expect(page.locator("[data-ai-survey-results-link]")).toHaveCount(0)
    await page.context().clearCookies()
    expect((await page.request.get("/api/ai-survey/results")).status()).toBe(401)

    // 응답을 정해 둔다 — 앞 시험들이 남긴 제출을 지우고 두 명만 둔다
    const names = ["사원1", "사원2", "사원3", "팀장", "부팀장"]
    await clearSurveys(names)
    const prisma = new PrismaClient()
    const users = Object.fromEntries((await prisma.user.findMany({ where: { name: { in: names } }, select: { id: true, name: true } })).map((u) => [u.name, u.id]))
    const put = (name: string, facts: Facts) => prisma.aiSurvey.create({ data: { userId: users[name], status: "SUBMITTED", submittedAt: new Date(), facts: JSON.parse(JSON.stringify(facts)) } })
    const f = (rest: object) => ({ turnId: "t", ...rest })
    await put("사원1", { daysPerWeek: f({ num: 5 }), hoursPerDay: f({ num: 3 }), payer: f({ values: ["personal"] }), monthlyFeeKrw: f({ num: 30000 }), pain: f({ labels: ["회사 자료를 모른다", "사원1만 쓴 아쉬움"] }), wishes: f({ values: ["search"] }) })
    await put("사원2", { daysPerWeek: f({ num: 2 }), hoursPerDay: f({ num: 1 }), payer: f({ values: ["none"] }), recentTask: f({ values: ["write"] }), pain: f({ labels: ["회사 자료를 모른다"] }) })

    await quickLogin(page, "팀장")
    // 결과 링크는 관리자 페이지 「운영」 의 설문 칸에 있다(2026-11-13)
    await page.goto("/admin/operations")
    await page.locator("[data-ai-survey-results-link]").click()
    const results = page.locator("[data-survey-results]")
    await expect(results).toBeVisible({ timeout: 30_000 })
    // 두 명 — 합계도 숨긴다
    await expect(results.locator("[data-survey-hidden]")).toContainText("응답 3명부터 보입니다")
    await expect(results.locator("[data-survey-company]")).toHaveCount(0)
    const two = (await (await page.request.get("/api/ai-survey/results")).json()) as { summary: { respondents: number; totals: unknown } }
    expect(two.summary).toMatchObject({ respondents: 2, totals: null })
    if (shots) await page.screenshot({ path: path.join(shots, "04-admin-hidden-light.png") })

    // 세 번째 — 앞뒤가 안 맞는 응답(지난주 0일 · 가장 최근 일이 지난주)
    await put("사원3", { daysPerWeek: f({ num: 0 }), recentTask: f({ values: ["write"] }), recentWhen: f({ num: 1 }) })
    await prisma.$disconnect()
    await page.reload()
    const company = results.locator("[data-survey-company]")
    await expect(company).toBeVisible({ timeout: 30_000 })
    await expect(company).toContainText("3 / ")
    await expect(company).toContainText("지난주 평균 사용 일수")
    await expect(company).toContainText("2.3일")
    await expect(company).toContainText("강도 분포")
    await expect(company).toContainText("유료로 쓰는 사람")
    await expect(company).toContainText("그중 개인이 내는 사람 1명")
    await expect(company).toContainText("95% 범위")
    await expect(company.locator("[data-survey-needs-check]")).toContainText("확인 필요 — 앞뒤가 안 맞는 응답 1명")
    await expect(company.locator("[data-survey-pains]")).toContainText("회사 자료를 모른다")
    // 한 명만 쓴 글 · 이름 · 사람별 탭이 없다
    await expect(company.locator("[data-survey-pains]")).not.toContainText("사원1만 쓴 아쉬움")
    for (const n of ["사원1", "사원2", "사원3"]) await expect(results).not.toContainText(n)
    await expect(results.getByRole("tab", { name: "사람별" })).toHaveCount(0)
    await expect(results.locator("[data-survey-person], [data-survey-metrics]")).toHaveCount(0)
    await page.screenshot({ path: shots ? path.join(shots, "05-admin-totals-light.png") : test.info().outputPath("admin.png"), fullPage: true })

    // API 도 합계만 — 이름 · 사람 id · 원문 · 사람별 지표가 없다
    const res = await page.request.get("/api/ai-survey/results")
    expect(res.status()).toBe(200)
    const body = await res.text()
    for (const leak of ["사원1", "사원2", "사원3", users["사원1"], users["사원2"], users["사원3"], "사원1만 쓴 아쉬움", "\"turns\"", "\"people\"", "\"evidence\""]) expect(body, `${leak} 가 새면 안 된다`).not.toContain(leak)
    expect(JSON.parse(body).summary.totals).toMatchObject({ needsCheck: 1, paid: 1, personalPay: 1, counted: 2 })

    // 다크
    await page.evaluate(() => localStorage.setItem("theme", "dark"))
    await page.reload()
    await expect(company).toBeVisible({ timeout: 30_000 })
    if (shots) await page.screenshot({ path: path.join(shots, "05-admin-totals-dark.png"), fullPage: true })

    await results.getByRole("tab", { name: "대기 · 비용" }).click()
    await expect(results.locator("[data-survey-latency]")).toContainText("첫 질문")
    await clearSurveys(names)
  })
})
