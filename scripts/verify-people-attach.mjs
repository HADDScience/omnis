// 사람끼리 방 첨부 화면 확인(Playwright) — 모델을 부르지 않는다. 로컬 dev 에서만 돌린다.
// 실행: A=$(… agent-cookie.ts 정우창) B=$(… 윤훈) C=$(… 허찬) BN=윤훈 BASE=http://localhost:3118 OUT=<캡처 폴더> IMAGE=<png> \
//       node scripts/verify-people-attach.mjs
//  1. A(390x844): B 와의 1:1 → ＋ 메뉴(파일 업로드 · 시놀로지 · 사람 언급, 업무 지시 · 업무 언급 없음) → 사진 붙여 보내기 → 말풍선 아래 미리보기
//  2. B(390x844): 같은 방에서 그 사진이 보이고 원본이 열린다
//  3. C(방 밖): 그 파일 주소를 열면 404
//  남는 것: A·B 1:1 에 시험 글 한 줄과 사진(로컬 DB · NAS _dev)
import { chromium } from "playwright"

const BASE = process.env.BASE ?? "http://localhost:3118"
const tok = (v) => (v ?? "").trim().split("\n").at(-1)
const [A, B, C] = [tok(process.env.A), tok(process.env.B), tok(process.env.C)]
if (!A || !B || !C) throw new Error("A · B · C 쿠키가 없다 — scripts/agent-cookie.ts 로 만든다")
const OUT = process.env.OUT ?? "."
const IMAGE = process.env.IMAGE
let fails = 0
const ok = (c, m) => {
  console.log(`${c ? "✓" : "✗"} ${m}`)
  if (!c) fails++
}

async function open(token) {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  await ctx.addCookies([{ name: "authjs.session-token", value: token, url: BASE }])
  return { browser, ctx, page: await ctx.newPage() }
}

// A·B 1:1 — 있으면 그 방(200 existing)
const users = await (await fetch(`${BASE}/api/users`, { headers: { cookie: `authjs.session-token=${A}` } })).json()
const bUser = users.find((u) => u.name === (process.env.BN ?? "윤훈"))
const dm = await (await fetch(`${BASE}/api/chat/people-rooms`, { method: "POST", headers: { cookie: `authjs.session-token=${A}`, "Content-Type": "application/json" }, body: JSON.stringify({ userIds: [bUser.id] }) })).json()
const roomUrl = `${BASE}/chat/${dm.roomId}`
const text = `[첨부 확인 ${new Date().toLocaleTimeString("ko-KR")}] 샘플 발송 현황 표예요`

// 1. A
let fileHref = null
{
  const { browser, page } = await open(A)
  await page.goto(roomUrl, { waitUntil: "networkidle" })
  await page.getByRole("button", { name: "추가" }).click()
  const items = await page.getByRole("menuitem").allInnerTexts()
  ok(items.some((t) => t.includes("파일 업로드")) && items.some((t) => t.includes("시놀로지 파일 연결")), `메뉴에 파일 업로드 · 시놀로지 (${items.map((t) => t.split("\n")[0]).join(" / ")})`)
  ok(!items.some((t) => t.includes("업무 지시") || t.includes("업무 언급")), "업무 지시 · 업무 언급은 없다")
  await page.screenshot({ path: `${OUT}/people-1-menu.png` })
  await page.keyboard.press("Escape")
  await page.locator('input[type="file"]').setInputFiles(IMAGE)
  await page.waitForTimeout(1000)
  await page.screenshot({ path: `${OUT}/people-2-chip.png` })
  await page.getByLabel("메시지 입력").fill(text)
  const posted = page.waitForResponse((r) => r.url().endsWith("/api/chat/messages") && r.request().method() === "POST")
  await page.getByRole("button", { name: "메시지 전송" }).click()
  const res = await posted
  const body = await res.json()
  ok(res.status() === 201 && body.files?.length === 1, `보냈다 201 · 첨부 ${body.files?.length}`)
  fileHref = body.files?.[0]?.path
  await page.locator(`img[src$="${fileHref}"]`).last().waitFor({ timeout: 15_000 })
  ok(true, "내 말풍선에 사진 미리보기")
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/people-3-sent.png` })
  await browser.close()
}

// 2. B
{
  const { browser, page } = await open(B)
  await page.goto(roomUrl, { waitUntil: "networkidle" })
  await page.locator(`img[src$="${fileHref}"]`).last().waitFor({ timeout: 15_000 })
  const loaded = await page.locator(`img[src$="${fileHref}"]`).last().evaluate((img) => img.complete && img.naturalWidth > 0)
  ok(loaded, "B(참여자)에게 사진이 보인다")
  await page.screenshot({ path: `${OUT}/people-4-b-sees.png` })
  const raw = await page.request.get(`${BASE}${fileHref}`)
  ok(raw.status() === 200, `B 원본 ${raw.status()}`)
  await browser.close()
}

// 3. C
{
  const { browser, page } = await open(C)
  const raw = await page.request.get(`${BASE}${fileHref}`)
  ok(raw.status() === 404, `C(방 밖) 원본 ${raw.status()} (거부되어야 하는 경우)`)
  const list = await (await page.request.get(`${BASE}/api/files`)).json()
  ok(!list.some((f) => fileHref.includes(f.id)), "C 의 최근 파일 목록에 없다")
  await page.goto(`${BASE}${fileHref}`)
  await page.screenshot({ path: `${OUT}/people-5-c-404.png` })
  await browser.close()
}

console.log(`방: ${roomUrl}`)
console.log(fails ? `실패 ${fails}` : "전부 통과")
process.exit(fails ? 1 : 0)
