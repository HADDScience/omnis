// 「답변 중지」 화면 확인(Playwright) — 실제 모델을 부른다(질문 2번). 로컬 dev 에서만 돌린다.
// 실행: TOKEN=$(pnpm exec tsx --env-file=.env scripts/agent-cookie.ts) BASE=http://localhost:3117 OUT=<캡처 폴더> node scripts/verify-agent-stop.mjs
//       ONLY=messenger | ONLY=panel 로 하나만
//  1. 390x844 · 메신저(/chat/new): 긴 답을 부르는 질문 → 답이 흐르는 중 보내기 자리가 ■(답변 중지)로 → 누르면 멈추고 「중지됨」 → 새로고침해도 남는다
//  2. 1440 · 오른쪽 패널 옴니스 탭: 보내자마자(실행 id 를 받기 전) ■ → 받는 즉시 멈추고, 글이 없으면 「답을 멈췄어요」
import { chromium } from "playwright"

const BASE = process.env.BASE ?? "http://localhost:3117"
const TOKEN = (process.env.TOKEN ?? "").trim().split("\n").at(-1)
if (!TOKEN) throw new Error("TOKEN 이 없다 — scripts/agent-cookie.ts 로 만든다")
const OUT = process.env.OUT ?? "."
const QUESTION = process.env.QUESTION ?? "이번 달 업무를 담당자별로 아주 자세히 정리해 줘"
let fails = 0
const ok = (c, m) => {
  console.log(`${c ? "✓" : "✗"} ${m}`)
  if (!c) fails++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function open(vp, mobile) {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: vp, hasTouch: mobile, isMobile: mobile, deviceScaleFactor: 2 })
  await ctx.addCookies([{ name: "authjs.session-token", value: TOKEN, url: BASE }])
  const page = await ctx.newPage()
  return { browser, page }
}

/** 보내기 자리의 단추 — 크기 · 이름 */
const sendSlot = (page, scope = "body") =>
  page.evaluate((scope) => {
    const root = document.querySelector(scope)
    const b = root.querySelector('button[aria-label="답변 중지"], button[aria-label="보내기"]')
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { label: b.getAttribute("aria-label"), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y), disabled: b.disabled }
  }, scope)

const ONLY = process.env.ONLY ?? ""

// ─── 1. 메신저 · 폰 ─────────────────────────────────────────────
if (ONLY !== "panel") {
  const { browser, page } = await open({ width: 390, height: 844 }, true)
  await page.goto(`${BASE}/chat/new`, { waitUntil: "networkidle" })
  const idle = await sendSlot(page)
  ok(idle?.label === "보내기", `처음은 보내기 단추 (${JSON.stringify(idle)})`)
  await page.getByLabel("옴니스에게 보낼 글").fill(QUESTION)
  await page.getByRole("button", { name: "보내기" }).click()

  await page.waitForSelector('button[aria-label="답변 중지"]', { timeout: 10_000 })
  const busy = await sendSlot(page)
  ok(busy?.label === "답변 중지" && busy.w === idle.w && busy.h === idle.h && busy.x === idle.x, `보내면 같은 자리 · 같은 크기의 ■ (${JSON.stringify(busy)})`)
  await page.screenshot({ path: `${OUT}/stop-1-button.png` })

  // 답 글이 어느 정도 흐를 때까지
  const t0 = Date.now()
  let streamed = 0
  while (Date.now() - t0 < 90_000) {
    streamed = await page.evaluate(() => document.querySelector("[data-agent-live]")?.textContent?.length ?? 0)
    if (streamed > 260) break
    await sleep(150)
  }
  ok(streamed > 260, `답이 흐르는 중 (${streamed}자, ${Date.now() - t0}ms)`)
  await page.screenshot({ path: `${OUT}/stop-2-streaming.png` })
  const before = await page.evaluate(() => document.querySelector("[data-agent-live]")?.textContent ?? "")

  const clickedAt = Date.now()
  await page.getByRole("button", { name: "답변 중지" }).click()
  await page.screenshot({ path: `${OUT}/stop-3-stopping.png` })
  // 끊은 뒤 화면의 글이 더 늘지 않는다(읽기를 바로 끊는다)
  await sleep(1200)
  const frozen = await page.evaluate(() => document.querySelector("[data-agent-live]")?.textContent ?? null)

  await page.waitForSelector("[data-agent-stopped]", { timeout: 20_000 })
  await page.waitForSelector('button[aria-label="보내기"]', { timeout: 20_000 })
  const settledMs = Date.now() - clickedAt
  const after = await page.evaluate(() => {
    const tag = document.querySelector("[data-agent-stopped]")
    const answer = tag?.closest(".min-w-0.flex-1")?.textContent ?? ""
    return {
      tag: tag?.textContent ?? "",
      answerLen: answer.length,
      live: !!document.querySelector("[data-agent-live]"),
      unanswered: document.body.textContent.includes("답을 받지 못했어요"),
      url: location.pathname,
    }
  })
  ok(frozen === null || frozen.length <= before.length + 400, `누른 뒤 흐름이 멈춘다 (누르기 전 ${before.length}자 → 1.2초 뒤 ${frozen?.length ?? "정리됨"})`)
  ok(after.tag.includes("중지됨") && after.answerLen > 100, `「중지됨」 이 붙은 답이 남는다 (${after.answerLen}자, 누르고 ${settledMs}ms)`)
  ok(!after.live && !after.unanswered, `흐르는 칸이 걷히고 「답을 받지 못했어요」 가 없다`)
  await page.screenshot({ path: `${OUT}/stop-4-stopped.png` })

  await page.reload({ waitUntil: "networkidle" })
  await sleep(500)
  const reloaded = await page.evaluate(() => ({
    tag: !!document.querySelector("[data-agent-stopped]"),
    unanswered: document.body.textContent.includes("답을 받지 못했어요"),
    send: !!document.querySelector('button[aria-label="보내기"]'),
  }))
  ok(reloaded.tag && !reloaded.unanswered && reloaded.send, `새로고침해도 「중지됨」 · 보내기 단추 (${JSON.stringify(reloaded)})`)
  await page.screenshot({ path: `${OUT}/stop-5-reloaded.png` })
  console.log(`방: ${after.url}`)
  await browser.close()
}

// ─── 2. 오른쪽 패널 · PC — 실행 id 를 받기 전에 누르기 ─────────────
if (ONLY !== "messenger") {
  const { browser, page } = await open({ width: 1440, height: 900 }, false)
  await page.goto(`${BASE}/tasks`, { waitUntil: "networkidle" })
  await page.getByRole("button", { name: /대화 패널 열기/ }).click()
  await page.getByRole("button", { name: "옴니스", exact: true }).click()
  const panel = '[aria-label="대화 패널"]'
  // 패널은 가장 최근 방을 연다 — 그 방에 이어 묻는다. (「새 대화」 단추는 앞 방 글이 남아 보이는 기존 문제가 있어 쓰지 않는다 — 작업 문서 「남은 문제」)
  await page.locator(panel).locator('[role="log"]').waitFor({ timeout: 30_000 })
  await page.waitForLoadState("networkidle")
  const marks = () => page.evaluate((panel) => document.querySelector(panel).querySelectorAll("[data-agent-stopped]").length, panel)
  const before = await marks()
  await page.locator(panel).getByLabel("옴니스에게 보낼 글").fill("올해 정부과제 목록을 하나씩 자세히 설명해 줘")
  await page.locator(panel).getByRole("button", { name: "보내기" }).click()
  // 보내자마자 — 아직 응답 머리(x-agent-run-id)가 오기 전
  await page.locator(panel).getByRole("button", { name: "답변 중지" }).click({ timeout: 5_000 })
  await page.screenshot({ path: `${OUT}/stop-6-panel-stopping.png` })
  await page.waitForFunction(([panel, n]) => document.querySelector(panel).querySelectorAll("[data-agent-stopped]").length > n, [panel, before], { timeout: 30_000 })
  await page.locator(panel).getByRole("button", { name: "보내기" }).waitFor({ timeout: 30_000 })
  const shown = await page.evaluate((panel) => {
    const p = document.querySelector(panel)
    const log = p.querySelector("[role=log]")
    return {
      last: [...log.children].at(-1)?.textContent ?? "",
      unanswered: p.textContent.includes("답을 받지 못했어요"),
      live: !!p.querySelector("[data-agent-live]"),
    }
  }, panel)
  // 머리를 받기 전에 눌렀으니 대개 글 없이 멈춘다(「답을 멈췄어요」). 첫 조각이 먼저 왔으면 「중지됨」
  ok((shown.last.includes("답을 멈췄어요") || shown.last.includes("중지됨")) && !shown.unanswered && !shown.live, `패널: 받는 즉시 멈춤 — 마지막 줄 ${JSON.stringify(shown)}`)
  await page.screenshot({ path: `${OUT}/stop-7-panel-stopped.png` })
  await browser.close()
}

console.log(fails ? `✗ ${fails}건 실패` : "✓ 전부 통과")
process.exit(fails ? 1 : 0)
