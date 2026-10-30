// 옴니스 4단계 결과물 화면 시나리오 — 로컬 dev 서버 · 실제 모델(비용 개인 부담, 시나리오당 질문 한 번).
//   TOKEN=$(pnpm exec tsx --env-file=.env scripts/agent-cookie.ts) OTHER=$(… agent-cookie.ts 윤훈) BASE=http://localhost:3119 OUT=<캡처 폴더> \
//     node scripts/output-scenarios.mjs <weekly|mail|file|records>
// 폰 390x844. 카드가 뜨면 캡처 → 확인 단추 → 실행 결과 · 답 캡처. file · mail 은 만든 파일을 실제로 내려받아 OUT 에 저장하고, 다른 사람(OTHER)에게 막히는지 본다.
import { chromium } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"

const BASE = process.env.BASE ?? "http://localhost:3119"
const TOKEN = process.env.TOKEN
const OTHER = process.env.OTHER
const OUT = process.env.OUT ?? "mydocs/working/omnis-outputs"
if (!TOKEN) throw new Error("TOKEN 이 필요하다 (scripts/agent-cookie.ts)")
mkdirSync(OUT, { recursive: true })
const scenario = process.argv[2]

const QUESTIONS = {
  weekly: "이번 주 내 주간보고 초안을 써 줘. 내 업무 목록을 보고 완료 · 진행 · 다음 주 계획으로 짧게. 저장은 카드로 물어봐",
  file: "아래 표로 엑셀 파일을 만들어 줘. 파일 이름은 「재고 현황」, 시트 이름은 「재고」, 열은 품목 · 수량 · 비고.\n애드젤 12 샘플용\n라이브젤 3 재주문 필요\n뉴로힐 5",
  mail: "아래 메일에 회신 초안을 써 줘. 보내지는 말고 초안만. 받는 사람은 김연구 교수(○○대), 원문 제목 「애드젤 샘플 문의」, 원문: 「애드젤 샘플 2개를 11월 둘째 주까지 받을 수 있을까요?」 — 11월 12일에 발송할 수 있다고 답해 줘",
  records: "어제(2026-10-29) 경기도경제과학진흥원 「2026 바이오 기술사업화 지원사업」 최종 선정 공문을 받았어. 이 대화에서 남길 것을 정리해서 기록 제안으로 올려 줘",
}
const CONFIRM = { weekly: "저장", mail: "저장", file: "만들기", records: "제안 올리기" }

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ko-KR", acceptDownloads: true })
await ctx.addCookies([{ name: "authjs.session-token", value: TOKEN, url: BASE }])
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE })
const page = await ctx.newPage()
page.on("console", (m) => { if (m.type() === "error") console.log("  [console]", m.text().slice(0, 200)) })

const shot = async (name, opts = {}) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  await page.screenshot({ path: `${OUT}/${name}.png`, ...opts })
  console.log(`  캡처 ${OUT}/${name}.png (가로 넘침 ${overflow}px)`)
}
const idle = () => page.waitForFunction(() => !document.querySelector("[data-agent-live]"), null, { timeout: 240_000, polling: 200 })

console.log(`[${scenario}] ${QUESTIONS[scenario].split("\n")[0]}`)
const t = performance.now()
await page.goto(`${BASE}/chat/new`)
const box = page.getByLabel("옴니스에게 보낼 글")
// 화면이 붙기(hydration) 전에 채우면 글이 상태에 들어가지 않아 보내기가 꺼져 있다 — 켜질 때까지 다시 채운다
const sendBtn = page.getByRole("button", { name: "보내기", exact: true })
for (let i = 0; i < 20 && !(await sendBtn.isEnabled()); i++) {
  await box.fill(QUESTIONS[scenario])
  await page.waitForTimeout(500)
}
// 폰은 Enter 가 줄바꿈 — 보내기 단추를 누른다
await sendBtn.click()
await page.waitForURL(/\/chat\/[0-9a-f-]{36}/, { timeout: 60_000 })
const roomUrl = page.url()
console.log(`  방 ${roomUrl}`)
const card = page.locator("[data-agent-card]").last()
await card.waitFor({ timeout: 240_000 })
await idle()
console.log(`  카드 ${((performance.now() - t) / 1000).toFixed(1)}s · 상태 ${await card.getAttribute("data-agent-card")}`)
await card.scrollIntoViewIfNeeded()
await shot(`${scenario}-1-card`)
if (await card.getByRole("button", { name: "펼치기" }).count()) {
  await card.getByRole("button", { name: "펼치기" }).click()
  await card.scrollIntoViewIfNeeded()
  await shot(`${scenario}-2-expanded`, { fullPage: false })
}
if (await card.getByRole("button", { name: "복사" }).count()) {
  await card.getByRole("button", { name: "복사" }).click()
  const copied = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "(읽지 못함)")
  console.log(`  복사한 글 앞부분: ${JSON.stringify(copied.slice(0, 60))}`)
}
if ((await card.getAttribute("data-agent-card")) !== "PENDING") {
  console.log("  확인 대기 카드가 아니다 — 여기서 멈춘다")
  await browser.close()
  process.exit(1)
}
const t2 = performance.now()
await card.getByRole("button", { name: CONFIRM[scenario], exact: true }).click()
await page.waitForFunction(() => {
  const c = [...document.querySelectorAll("[data-agent-card]")].pop()
  return c && ["EXECUTED", "FAILED"].includes(c.getAttribute("data-agent-card")) && !document.querySelector("[data-agent-live]")
}, null, { timeout: 240_000, polling: 200 })
await page.waitForTimeout(800)
console.log(`  실행 ${((performance.now() - t2) / 1000).toFixed(1)}s · 상태 ${await card.getAttribute("data-agent-card")}`)
console.log(`  결과: ${(await card.locator("p").last().innerText()).slice(0, 300)}`)
await page.locator('[role="log"]').locator("> *").last().scrollIntoViewIfNeeded()
await shot(`${scenario}-3-done`)

if (scenario === "file" || scenario === "mail") {
  const link = page.locator('[role="log"] a[href*="/api/files/"]').last()
  const href = await link.getAttribute("href")
  const name = await link.getAttribute("title")
  console.log(`  파일 카드 ${name} → ${href}`)
  await link.scrollIntoViewIfNeeded()
  await shot(`${scenario}-4-file-card`)
  const res = await page.request.get(new URL(href, BASE).toString())
  const body = await res.body()
  writeFileSync(`${OUT}/${name}`, body)
  console.log(`  내려받기 ${res.status()} · ${res.headers()["content-type"]} · ${body.length}B → ${OUT}/${name}`)
  const id = href.match(/files\/([0-9a-f-]{36})/)[1]
  const mine = await page.request.get(`${BASE}/api/files`)
  console.log(`  내 GET /api/files 목록에 있나: ${(await mine.json()).some((f) => f.id === id)}`)
  if (OTHER) {
    const other = await browser.newContext()
    await other.addCookies([{ name: "authjs.session-token", value: OTHER, url: BASE }])
    const r1 = await other.request.get(`${BASE}/api/files/${id}/raw`)
    const r2 = await other.request.get(`${BASE}/api/files/${id}`)
    const r3 = await other.request.get(`${BASE}/api/files`)
    const r4 = await other.request.get(roomUrl)
    console.log(`  다른 사람: raw ${r1.status()} · 정보 ${r2.status()} · 목록에 있나 ${(await r3.json()).some((f) => f.id === id)} · 방 주소 ${r4.status()}`)
  }
}
await browser.close()
