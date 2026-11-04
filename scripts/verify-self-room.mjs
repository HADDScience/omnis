// 나와의 대화 첨부 — 실제 업로드로 확인(Playwright). 데모가 아닌 로컬 dev 에서만 돌린다(데모에는 첨부가 없다).
// 실행: BASE=http://localhost:3118 IMAGE=<png> node scripts/verify-self-room.mjs
// 남는 것: 이 DB 의 시험 글과 시놀로지 _dev 의 시험 사진. 운영 주소에는 돌리지 않는다.
import { readFileSync } from "node:fs"
import path from "node:path"
import { chromium } from "playwright"

const BASE = process.env.BASE ?? "http://localhost:3118"
if (!/localhost|127\.0\.0\.1/.test(BASE)) throw new Error("로컬 서버에만 돌린다")
const buffer = readFileSync(process.env.IMAGE)
let fails = 0
const ok = (c, m) => {
  console.log(`${c ? "✓" : "✗"} ${m}`)
  if (!c) fails++
}
const browser = await chromium.launch()
async function signIn(name) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`)
  await page.getByRole("textbox", { name: "이름" }).fill(name)
  await page.getByRole("textbox", { name: "비밀번호" }).fill(process.env.USER_PASSWORD ?? "demo1234")
  await page.getByRole("button", { name: "로그인", exact: true }).click()
  await page.waitForURL("**/chat", { timeout: 60_000 })
  return page
}
const owner = await signIn("팀장")
const other = await signIn("사원2")
const { roomId } = await (await owner.request.post(`${BASE}/api/chat/self-room`)).json()
await owner.goto(`${BASE}/chat/${roomId}`)
const box = owner.locator("[data-composer-pill] textarea").first()
await box.waitFor({ timeout: 60_000 })
for (let i = 0; i < 200; i++) {
  if (await box.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps")))) break
  await owner.waitForTimeout(150)
}
const note = `첨부 메모 ${Date.now()}`
await owner.locator("[data-composer-file-input]").first().setInputFiles({ name: path.basename(process.env.IMAGE), mimeType: "image/png", buffer })
await box.fill(note)
const uploaded = owner.waitForResponse((r) => r.url().endsWith("/api/files") && r.request().method() === "POST", { timeout: 60_000 })
const posted = owner.waitForResponse((r) => r.url().endsWith("/api/chat/messages") && r.request().method() === "POST", { timeout: 60_000 })
await box.press("Enter")
const up = await uploaded
ok(up.status() === 201, `실제 업로드 HTTP ${up.status()}`)
const file = await up.json()
const msg = await posted
ok(msg.ok(), `글 저장 HTTP ${msg.status()}`)
ok((await msg.json()).files?.[0]?.id === file.id, "파일이 글에 붙었다")
const mine = await owner.request.get(`${BASE}${file.path}`)
ok(mine.status() === 200 && (await mine.body()).equals(buffer), `내가 내려받는다(HTTP ${mine.status()})`)
const theirs = await other.request.get(`${BASE}${file.path}`)
ok(theirs.status() === 404, `다른 사람은 받지 못한다(HTTP ${theirs.status()})`)
await browser.close()
console.log(fails === 0 ? "모두 통과" : `실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
