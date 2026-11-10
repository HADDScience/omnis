// 폰 ＋ 시트의 첨부 항목 확인(Playwright). 데모 빌드에는 첨부가 없어 일반 빌드로 돌린다. 로컬 전용 — 모델을 부르지 않는다.
// 실행: A=$(tsx scripts/agent-cookie.ts <이름>) PEER=<상대 이름> BASE=http://localhost:3105 OUT=<캡처 폴더> node scripts/verify-composer-plus-sheet.mjs
import { chromium } from "playwright"

const BASE = process.env.BASE ?? "http://localhost:3105"
const A = (process.env.A ?? "").trim().split("\n").at(-1)
if (!A) throw new Error("A 쿠키가 없다 — scripts/agent-cookie.ts 로 만든다")
const OUT = process.env.OUT ?? "."
let fails = 0
const ok = (c, m) => {
  console.log(`${c ? "✓" : "✗"} ${m}`)
  if (!c) fails++
}
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==", "base64")
const sheet = (page) => page.locator("[data-composer-plus-sheet]")
const plus = (page) => page.locator('[data-composer-pill] button[aria-label="추가"]').first()
const box = (page) => page.locator("[data-composer-pill] textarea").first()
const chips = (page) => page.locator("[data-composer-attachments] [data-attach-status]")

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
await ctx.addCookies([{ name: "authjs.session-token", value: A, url: BASE }])
const page = await ctx.newPage()

const users = await (await ctx.request.get(`${BASE}/api/users`)).json()
const peer = users.find((u) => u.name === (process.env.PEER ?? "사원1"))
const dm = await (await ctx.request.post(`${BASE}/api/chat/people-rooms`, { data: { userIds: [peer.id] } })).json()
const data = await (await ctx.request.get(`${BASE}/api/tasks`)).json()
const task = (Array.isArray(data) ? data : data.tasks)[0]

async function enter(url) {
  await page.goto(`${BASE}${url}`)
  await box(page).waitFor({ timeout: 30_000 })
  await page.waitForFunction(() => {
    const el = document.querySelector("[data-composer-pill] textarea")
    return el && Object.keys(el).some((k) => k.startsWith("__reactProps"))
  })
}
async function openSheet() {
  await plus(page).tap()
  await sheet(page).waitFor()
  await page.waitForTimeout(600)
}
const labels = async () => (await sheet(page).locator("button").allInnerTexts()).map((t) => t.split("\n")[0].trim())
async function closeSheet() {
  await page.touchscreen.tap(195, 120)
  await sheet(page).waitFor({ state: "hidden" })
}
async function choose(name, file) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), sheet(page).getByRole("button", { name }).tap()])
  const attrs = await chooser.element().evaluate((el) => ({ accept: el.accept, multiple: el.multiple, capture: el.hasAttribute("capture") }))
  await chooser.setFiles(file)
  return attrs
}

for (const [name, url, expected] of [
  ["전사", "/chat/default-room", ["사진", "파일 업로드", "시놀로지 파일 연결", "업무 지시", "사람 언급", "업무 언급"]],
  ["사람", `/chat/${dm.roomId}`, ["사진", "파일 업로드", "시놀로지 파일 연결", "사람 언급"]],
  ["업무", `/chat/task/${task.id}`, null],
  ["옴니스", "/chat/new", ["사진", "파일 업로드", "시놀로지 파일 연결"]],
]) {
  await enter(url)
  await openSheet()
  const got = await labels()
  ok(got.slice(0, 3).join() === "사진,파일 업로드,시놀로지 파일 연결" && (!expected || got.join() === expected.join()), `${name} 항목: ${got.join(" / ")}`)
  if (name === "전사") await page.screenshot({ path: `${OUT}/plus-sheet.png` })
  await closeSheet()
}

await enter(`/chat/${dm.roomId}`)
await box(page).fill("첨부와 함께 쓰던 글")
await openSheet()
const photo = await choose("사진", { name: "photo.png", mimeType: "image/png", buffer: png })
ok(photo.accept === "image/*" && photo.multiple && !photo.capture, `사진 입력: accept=${photo.accept} multiple=${photo.multiple} capture=${photo.capture}`)
await sheet(page).waitFor({ state: "hidden" })
await chips(page).first().waitFor()
ok((await chips(page).count()) === 1, "사진을 고르면 칩이 붙는다")

await openSheet()
await closeSheet()
ok((await chips(page).count()) === 1, "시트를 열고 닫아도 첨부가 남는다")
ok((await box(page).inputValue()) === "첨부와 함께 쓰던 글", "쓰던 글도 남는다")

await openSheet()
const file = await choose("파일 업로드", { name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("시험") })
ok(file.accept === "" && file.multiple, `파일 입력: accept 없음, multiple=${file.multiple}`)
await page.waitForFunction(() => document.querySelectorAll("[data-composer-attachments] [data-attach-status]").length === 2)
ok(true, "다른 항목으로 고르면 앞 첨부에 더해진다")

await openSheet()
await sheet(page).getByRole("button", { name: "시놀로지 파일 연결" }).tap()
await page.getByRole("dialog", { name: "시놀로지 파일 연결" }).waitFor({ timeout: 10_000 })
ok(true, "시놀로지 항목이 고르기 창을 연다")
await page.getByRole("button", { name: /close|닫기/i }).first().tap().catch(() => page.keyboard.press("Escape"))
await page.waitForTimeout(600)
ok((await chips(page).count()) === 2, "창을 닫아도 첨부가 남는다")
await box(page).tap()
ok(await box(page).evaluate((el) => document.activeElement === el), "닫은 뒤 입력칸을 다시 쓸 수 있다")

await browser.close()
console.log(fails ? `실패 ${fails}` : "모두 통과")
process.exit(fails ? 1 : 0)
