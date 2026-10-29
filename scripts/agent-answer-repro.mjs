// 「답을 받지 못했어요」 가 답이 정상으로 오는데도 뜨던 일 — 화면 재현(로컬 dev · 실제 모델 1회).
//   TOKEN=$(pnpm exec tsx --env-file=.env scripts/agent-cookie.ts) BASE=http://localhost:3103 \
//     node scripts/agent-answer-repro.mjs [reload|offline]
//
// reload  — 보낸 뒤 1.5초에 새로고침(폰에서 앱을 바꿨다 돌아오면 브라우저가 페이지를 다시 연다)
// offline — 보낸 뒤 스트림이 오는 도중 2초 동안 연결을 끊는다(폰 화면이 꺼지거나 망이 바뀔 때)
// 100ms 마다 화면을 읽어 「답을 받지 못」 · 「다시 묻기」 가 한 번이라도 보이면 실패(exit 1).
import { chromium } from "playwright"

const BASE = process.env.BASE ?? "http://localhost:3103"
const TOKEN = process.env.TOKEN
if (!TOKEN) throw new Error("TOKEN 이 필요하다 (scripts/agent-cookie.ts)")
const mode = process.argv[2] ?? "reload"

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: "ko-KR", hasTouch: true, isMobile: true })
await ctx.addCookies([{ name: "authjs.session-token", value: TOKEN, url: BASE }])
const page = await ctx.newPage()
const t0 = performance.now()
const at = () => `${((performance.now() - t0) / 1000).toFixed(1)}s`
page.on("request", (r) => { if (r.url().includes("/api/agent")) console.log(`  ${at()} → ${r.method()} ${new URL(r.url()).pathname}`) })
page.on("response", (r) => { if (r.url().includes("/api/agent")) console.log(`  ${at()} ← ${r.status()} ${new URL(r.url()).pathname}`) })

await page.goto(`${BASE}/chat/new`)
const box = page.getByLabel("옴니스에게 보낼 글")
await box.fill("재현 시험 — 한 줄로 인사만 해 줘")
await page.getByRole("button", { name: "보내기" }).click()
console.log(`  ${at()} 보냄 (${mode})`)

const seen = []
let answered = false
const sample = setInterval(async () => {
  const txt = await page.evaluate(() => document.querySelector("main")?.innerText ?? "").catch(() => "")
  if (/답을 받지 못|다시 묻기/.test(txt)) seen.push(at())
  const omnis = await page.locator('[role="log"] .omnis-md').count().catch(() => 0)
  const live = await page.locator("[data-agent-live]").count().catch(() => 0)
  if (omnis > 0 && live === 0) answered = true
}, 100)

if (mode === "reload") {
  // 방이 생겨 주소가 /chat/<방> 으로 바뀐 뒤(스트림이 오는 중)
  await page.waitForURL(/\/chat\/[0-9a-f-]{36}/, { timeout: 30_000 })
  await page.waitForTimeout(500)
  console.log(`  ${at()} 새로고침 ${new URL(page.url()).pathname}`)
  await page.reload()
} else {
  await page.locator("[data-agent-live]").waitFor()
  await page.waitForTimeout(800)
  console.log(`  ${at()} 연결 끊음`)
  await ctx.setOffline(true)
  await page.waitForTimeout(2000)
  await ctx.setOffline(false)
  console.log(`  ${at()} 연결 돌아옴`)
}
const deadline = performance.now() + 90_000
while (!answered && performance.now() < deadline) await page.waitForTimeout(200)
await page.waitForTimeout(1500)
clearInterval(sample)
await browser.close()

console.log(`  답: ${answered ? "받음" : "못 받음"} · 「답을 받지 못 / 다시 묻기」 보인 순간 ${seen.length}번${seen.length ? ` (${seen[0]} ~ ${seen.at(-1)})` : ""}`)
if (!answered || seen.length) {
  console.log("✗ 실패")
  process.exit(1)
}
console.log("✓ 통과")
