// 옴니스 에이전트 화면 시나리오 — 로컬 dev 서버 · 실제 모델(비용 개인 부담, 시나리오당 한두 번).
//   TOKEN=$(pnpm exec tsx --env-file=.env scripts/agent-cookie.ts) BASE=http://localhost:3103 \
//     node scripts/agent-scenarios.mjs <1|2|3|4|5> [roomId]
// 스크린샷: mydocs/working/omnis-agent/
import { chromium } from "playwright"
import { mkdirSync } from "node:fs"

const BASE = process.env.BASE ?? "http://localhost:3103"
const TOKEN = process.env.TOKEN
if (!TOKEN) throw new Error("TOKEN 이 필요하다 (scripts/agent-cookie.ts)")
const OUT = "mydocs/working/omnis-agent"
mkdirSync(OUT, { recursive: true })
const [scenario, roomArg] = process.argv.slice(2)

const browser = await chromium.launch()
async function pageAt(width) {
  const ctx = await browser.newContext({ viewport: { width, height: width >= 1000 ? 900 : 812 }, deviceScaleFactor: width >= 1000 ? 1 : 2, locale: "ko-KR" })
  await ctx.addCookies([{ name: "authjs.session-token", value: TOKEN, url: BASE }])
  const page = await ctx.newPage()
  page.on("console", (m) => { if (m.type() === "error") console.log("  [console]", m.text().slice(0, 200)) })
  return page
}
const shot = async (page, name) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log(`  📷 ${OUT}/${name}.png (가로 넘침 ${overflow}px)`)
}
const t0 = () => performance.now()
const sec = (t) => `${((performance.now() - t) / 1000).toFixed(1)}s`

/** 화면에 쌓인 것 — 옴니스 글 수 + 카드 수 */
const settled = (page) => page.evaluate(() => document.querySelectorAll('[role="log"] .omnis-md').length + document.querySelectorAll("[data-agent-card]").length)
let sentAt = 0
let before = 0
async function send(page, text) {
  before = await settled(page)
  const box = page.getByLabel("옴니스에게 보낼 글")
  await box.fill(text)
  sentAt = performance.now()
  await box.press("Enter")
}
/**
 * 스트림이 끝나 라이브 칸이 사라지고 새 글이나 카드가 붙을 때까지. 보낸 때부터 첫 글자 · 끝을 잰다.
 * 빠르면 몇 초 만에 끝나 「보이기를 기다리기」 는 놓친다 — 쌓인 수로 판단한다
 */
async function waitAnswer(page, label, from = sentAt) {
  let firstText = null
  const poll = setInterval(async () => {
    if (firstText) return
    const has = await page.locator("[data-agent-live] .omnis-md").count().catch(() => 0)
    if (has) firstText = sec(from)
  }, 100)
  await page.waitForFunction(
    (n) => !document.querySelector("[data-agent-live]") && document.querySelectorAll('[role="log"] .omnis-md').length + document.querySelectorAll("[data-agent-card]").length > n,
    before,
    { timeout: 180_000, polling: 100 },
  )
  clearInterval(poll)
  console.log(`  ${label}: 첫 글자 ${firstText ?? "(글 없음 — 카드만)"} · 끝 ${sec(from)}`)
}
const lastOmnis = (page) => page.locator('[role="log"] .omnis-md').last().innerText()

if (scenario === "1") {
  console.log("[1] 읽기 질문 1턴 — 1440")
  const page = await pageAt(1440)
  await page.goto(`${BASE}/chat/new`)
  await send(page, "이번 주(10/26~11/1) 마감인 업무를 담당자와 함께 정리해 줘")
  const firstAt = sentAt
  await page.locator("[data-agent-live]").waitFor({ state: "visible" })
  await shot(page, "1440-1-streaming-start")
  // 글이 흘러나오는 중의 한 장
  await page.locator("[data-agent-live] .omnis-md").waitFor({ timeout: 60_000 }).catch(() => {})
  console.log(`  첫 글자까지 ${sec(firstAt)} (스크린샷 시간 포함)`)
  await shot(page, "1440-1-streaming-text")
  await waitAnswer(page, "1턴", firstAt)
  await page.locator('[role="log"] .omnis-md').last().waitFor()
  await shot(page, "1440-1-answer")
  // 답하는 도중 새로고침 — 돌던 실행에 다시 붙어 답이 이어져야 한다
  await send(page, "그 업무들 중 지연된 것은 몇 건이야? 한 줄로")
  await page.locator("[data-agent-live]").waitFor({ state: "visible" })
  await page.waitForTimeout(1500)
  const before = await page.locator('[role="log"] .omnis-md').count()
  await page.reload()
  const re = t0()
  await page.locator("[data-agent-live]").waitFor({ state: "visible", timeout: 15_000 }).then(() => console.log("  새로고침 뒤 다시 붙음(스트림 칸 보임)"), () => console.log("  새로고침 뒤 스트림 칸 없음"))
  await page.locator("[data-agent-live]").waitFor({ state: "detached", timeout: 120_000 })
  await page.waitForFunction((n) => document.querySelectorAll('[role="log"] .omnis-md').length > n, before, { timeout: 30_000 })
  console.log(`  새로고침 뒤 답이 붙음 (${sec(re)})`)
  await shot(page, "1440-1-after-reload")
  console.log("  방", page.url())
  console.log("  답 앞부분:", (await lastOmnis(page)).slice(0, 200).replace(/\n/g, " / "))
  const p2 = await pageAt(375)
  await p2.goto(page.url())
  await p2.locator('[role="log"] .omnis-md').last().waitFor()
  await shot(p2, "375-1-answer")
}

if (scenario === "2") {
  console.log("[2] 쓰기 요청 → 확인 카드 → [확인] — 1440")
  const page = await pageAt(1440)
  await page.goto(roomArg ? `${BASE}/chat/${roomArg}` : `${BASE}/chat/new`)
  await send(page, "「에이전트 확인 흐름 점검」 업무 마감을 2026-11-12 로 미루고 우선순위를 높음으로 바꿔 줘")
  await waitAnswer(page, "제안")
  const card = page.locator('[data-agent-card="PENDING"]').last()
  await card.waitFor({ timeout: 10_000 })
  await card.scrollIntoViewIfNeeded()
  await shot(page, "1440-2-card")
  console.log("  카드:", (await card.innerText()).replace(/\n/g, " / ").slice(0, 400))
  before = await settled(page)
  sentAt = performance.now()
  await card.getByRole("button", { name: "확인" }).click()
  await page.locator('[data-agent-card="EXECUTED"]').last().waitFor({ timeout: 120_000 })
  await waitAnswer(page, "확인 뒤 이어 감")
  await page.locator('[data-agent-card="EXECUTED"]').last().waitFor({ timeout: 10_000 })
  await shot(page, "1440-2-executed")
  console.log("  실행 뒤 답:", (await lastOmnis(page)).slice(0, 200).replace(/\n/g, " / "))
  console.log("  방", page.url())
  // 375 는 1440 조작이 끝난 뒤에 — dev 서버가 같은 방 경로를 다시 컴파일하면 열려 있던 1440 화면을 새로 읽는다
  const p2 = await pageAt(375)
  await p2.goto(page.url())
  await p2.locator('[data-agent-card="EXECUTED"]').last().scrollIntoViewIfNeeded()
  await shot(p2, "375-2-executed")
}

if (scenario === "4") {
  console.log("[4] 확인 카드 상태에서 새로고침 — 375 · 1440")
  const page = await pageAt(375)
  await page.goto(`${BASE}/chat/${roomArg}`)
  await send(page, "그 업무 상태를 완료로 바꿔 줘")
  await waitAnswer(page, "제안")
  await page.locator('[data-agent-card="PENDING"]').last().waitFor({ timeout: 10_000 })
  await page.reload()
  const card = page.locator('[data-agent-card="PENDING"]').last()
  await card.waitFor({ timeout: 15_000 })
  await card.scrollIntoViewIfNeeded()
  await shot(page, "375-4-after-reload")
  console.log("  새로고침 뒤 카드:", (await card.innerText()).replace(/\n/g, " / ").slice(0, 300))
  const p2 = await pageAt(1440)
  await p2.goto(`${BASE}/chat/${roomArg}`)
  await p2.locator('[data-agent-card="PENDING"]').last().scrollIntoViewIfNeeded()
  await shot(p2, "1440-4-after-reload")
}

if (scenario === "3") {
  console.log("[3] [취소] — 375 (4 에서 남긴 카드)")
  const page = await pageAt(375)
  await page.goto(`${BASE}/chat/${roomArg}`)
  const card = page.locator('[data-agent-card="PENDING"]').last()
  await card.waitFor({ timeout: 15_000 })
  await card.scrollIntoViewIfNeeded()
  before = await settled(page)
  sentAt = performance.now()
  await card.getByRole("button", { name: "취소" }).click()
  await page.locator('[data-agent-card="REJECTED"]').last().waitFor({ timeout: 120_000 })
  await waitAnswer(page, "취소 뒤 이어 감")
  await page.locator('[data-agent-card="REJECTED"]').last().scrollIntoViewIfNeeded()
  await shot(page, "375-3-rejected")
  console.log("  취소 뒤 답:", (await lastOmnis(page)).slice(0, 200).replace(/\n/g, " / "))
}

if (scenario === "5") {
  console.log(`[5] 비밀번호를 카드로 — 1440 ${roomArg ? "(다른 문구)" : ""}`)
  const page = await pageAt(1440)
  await page.goto(`${BASE}/chat/new`)
  await send(page, roomArg === "license"
    ? "「에이전트 확인 흐름 점검」 업무 배경에 이 문장을 그대로 적어 줘: 분석 도구 라이선스 코드 sk-proj-AbCdEfGhIjKlMnOpQrStUvWx1234 로 등록함"
    : roomArg === "wifi"
    ? "업무 절차 분류에 「손님 와이파이 안내」 지식 카드를 만들어 줘. 본문: 이름 HADD-Guest / 비번 haddguest5G / 손님이 오면 알려 주기"
    : "지식 카드 하나 만들어 줘. 분류는 업무 절차, 제목은 「사무실 공용 PC 안내」, 본문은 「공용 PC 로그인 비밀번호: hadd2024! — 퇴근 때 꼭 잠그기」 그대로.")
  await waitAnswer(page, "답")
  const blocked = page.locator('[data-agent-card="BLOCKED"]')
  if (await blocked.count()) {
    await blocked.last().scrollIntoViewIfNeeded()
    console.log("  막힌 카드:", (await blocked.last().innerText()).replace(/\n/g, " / ").slice(0, 400))
  } else {
    console.log("  카드 없음 — 모델이 쓰기 도구를 부르지 않았다")
  }
  console.log("  답:", (await lastOmnis(page).catch(() => "(옴니스 글 없음)")).slice(0, 300).replace(/\n/g, " / "))
  await shot(page, `1440-5-secret${roomArg ? `-${roomArg}` : ""}`)
  console.log("  방", page.url())
  const p2 = await pageAt(375)
  await p2.goto(page.url())
  await p2.locator('[role="log"] > *').last().scrollIntoViewIfNeeded()
  await shot(p2, `375-5-secret${roomArg ? `-${roomArg}` : ""}`)
}

await browser.close()
