// 사진을 올리는 동안 다음 글 보내기 — 실제 업로드로 확인(Playwright). 모델을 부르지 않는다. 데모가 아닌 로컬 dev 에서만 돌린다(데모에는 첨부가 없다).
// 실행: BASE=http://localhost:3118 USER_NAME=팀장 USER_PASSWORD=… IMAGE=<png> OUT=<캡처 폴더> node scripts/verify-upload-queue.mjs
//  전사 · 사람 · 업무 방마다
//   1. 사진 글을 보내고 올리는 동안 다음 글을 쓴다 → 말풍선 둘이 바로 뜨고, 다음 글은 사진 글 뒤에 서버에 닿는다
//   2. 올린 파일을 실제로 내려받는다
//   3. 업로드가 실패하면 그 글과 사진만 입력칸으로 돌아오고, 뒤 글은 보내진다
//  남는 것: 이 DB 의 시험 글과 시놀로지 _dev 의 시험 사진. 운영 주소에는 돌리지 않는다.
import { readFileSync } from "node:fs"
import path from "node:path"
import { chromium } from "playwright"

const BASE = process.env.BASE ?? "http://localhost:3118"
if (!/localhost|127\.0\.0\.1/.test(BASE)) throw new Error("로컬 서버에만 돌린다")
const IMAGE = process.env.IMAGE
if (!IMAGE) throw new Error("IMAGE 가 없다")
const image = { name: path.basename(IMAGE), mimeType: "image/png", buffer: readFileSync(IMAGE) }
const OUT = process.env.OUT
const PILL = "[data-composer-pill]"

let fails = 0
const ok = (c, m) => {
  console.log(`${c ? "✓" : "✗"} ${m}`)
  if (!c) fails++
}
const until = async (check, ms = 20_000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await check()) return true
    await new Promise((r) => setTimeout(r, 150))
  }
  return false
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
await page.goto(`${BASE}/login`)
await page.getByRole("textbox", { name: "이름" }).fill(process.env.USER_NAME ?? "팀장")
await page.getByRole("textbox", { name: "비밀번호" }).fill(process.env.USER_PASSWORD ?? "demo1234")
await page.getByRole("button", { name: "로그인", exact: true }).click()
await page.waitForURL("**/chat", { timeout: 60_000 })

const api = (url) => page.request.get(`${BASE}${url}`)
const users = await (await api("/api/users")).json()
const other = users.find((u) => u.name === "사원1")
const dm = await (await page.request.post(`${BASE}/api/chat/people-rooms`, { data: { userIds: [other.id] } })).json()
const tasksBody = await (await api("/api/tasks")).json()
const task = (Array.isArray(tasksBody) ? tasksBody : tasksBody.tasks)[0]

const rooms = [
  { name: "전사", url: "/chat/default-room", roomId: "default-room" },
  { name: "사람", url: `/chat/${dm.roomId}`, roomId: dm.roomId },
  { name: "업무", url: `/chat/task/${task.id}`, roomId: "default-room", task: true },
]

for (const room of rooms) {
  console.log(`--- ${room.name} 방`)
  await page.goto(`${BASE}${room.url}`, { waitUntil: "domcontentloaded" })
  const box = page.locator(`${PILL} textarea`).first()
  await box.waitFor({ timeout: 60_000 })
  // 서버가 그린 입력칸이 먼저 보인다 — React 가 붙은 뒤에 쓴다(그 전의 Enter 는 그냥 줄바꿈이다)
  await until(() => box.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))), 60_000)
  const posts = []
  const uploads = []
  let holdUpload = 5_000
  let failUpload = false
  const onMessages = async (route) => {
    if (route.request().method() === "POST") posts.push(JSON.parse(route.request().postData() ?? "{}"))
    await route.continue()
  }
  const onFiles = async (route) => {
    if (route.request().method() !== "POST") return route.continue()
    if (failUpload) {
      uploads.push(500)
      // 바로 실패하면 뒤 글을 쓰기도 전에 글이 돌아온다 — 뒤 글을 보낸 다음에 실패하게 둔다
      await new Promise((r) => setTimeout(r, 2_000))
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "시험 업로드 실패" }) })
    }
    await new Promise((r) => setTimeout(r, holdUpload))
    const res = await route.fetch()
    uploads.push(res.status())
    room.lastFile = await res.json().catch(() => null)
    await route.fulfill({ response: res })
  }
  await page.route("**/api/chat/messages", onMessages)
  await page.route("**/api/files", onFiles)

  // 1. 올리는 동안 다음 글
  const stamp = Date.now()
  const photoText = `사진 글 ${room.name} ${stamp}`
  const nextText = `다음 글 ${room.name} ${stamp}`
  const fileInput = page.locator("[data-composer-file-input]").first()
  await fileInput.setInputFiles(image)
  await box.fill(photoText)
  await box.press("Enter")
  ok((await box.inputValue()) === "", "사진 글을 보내자 입력칸이 바로 빈다")
  await box.fill(nextText)
  await box.press("Enter")
  ok((await box.inputValue()) === "", "올리는 동안 다음 글을 보낼 수 있다")
  ok(await until(() => page.getByText(photoText).first().isVisible(), 3_000), "사진 글 말풍선이 바로 뜬다")
  ok(await until(() => page.getByText(nextText).first().isVisible(), 3_000), "다음 글 말풍선도 바로 뜬다")
  ok(await box.evaluate((el) => document.activeElement === el), "입력칸에 그대로 있다")
  if (OUT) await page.screenshot({ path: path.join(OUT, `queue-${room.name}.png`) })
  ok(posts.length === 0, `올리는 동안 서버로 간 글 없음(${posts.length})`)
  ok(await until(() => posts.length === 2, 60_000), "업로드가 끝나면 두 글이 차례로 닿는다")
  ok(posts[0]?.content === photoText && posts[1]?.content === nextText, "서버에 닿은 순서 = 쓴 순서")
  ok(posts[0]?.fileIds?.length === 1 && (posts[1]?.fileIds?.length ?? 0) === 0, "사진은 사진 글에만 붙는다")
  ok(uploads[0] === 201, `실제 업로드 HTTP ${uploads[0]}`)

  // 2. 실제로 내려받는다
  const raw = await page.request.get(`${BASE}${room.lastFile?.path}`)
  const body = await raw.body()
  ok(raw.status() === 200 && body.equals(image.buffer), `올린 파일을 그대로 내려받는다(HTTP ${raw.status()}, ${body.length}바이트)`)

  // 서버 기준 순서 · 중복
  const query = room.task ? `roomId=${room.roomId}&taskId=${task.id}` : `roomId=${room.roomId}`
  const saved = await (await api(`/api/chat/messages?${query}`)).json()
  const list = Array.isArray(saved) ? saved : saved.messages
  const a = list.filter((m) => m.content === photoText)
  const b = list.filter((m) => m.content === nextText)
  ok(a.length === 1 && b.length === 1, `두 글이 한 번씩 저장(${a.length}, ${b.length})`)
  ok(a[0] && b[0] && new Date(a[0].createdAt) <= new Date(b[0].createdAt), "저장 시각도 쓴 순서")

  // 3. 업로드 실패
  await until(() => page.getByText("업로드 중...").count().then((n) => n === 0), 10_000)
  failUpload = true
  posts.length = 0
  const failText = `실패할 사진 글 ${room.name} ${stamp}`
  const afterText = `뒤 글 ${room.name} ${stamp}`
  await fileInput.setInputFiles(image)
  await box.fill(failText)
  await box.press("Enter")
  await box.fill(afterText)
  await box.press("Enter")
  ok(await until(() => posts.length === 1), "실패한 글을 건너 뒤 글이 닿는다")
  ok(posts[0]?.content === afterText, "실패한 글은 서버로 가지 않는다")
  ok(await until(async () => (await box.inputValue()) === failText), "실패한 글이 입력칸으로 돌아온다")
  ok(await until(() => page.locator("[data-composer-attachments]").first().isVisible()), "실패한 사진이 첨부 칩으로 돌아온다")
  ok(await until(() => page.getByText("시험 업로드 실패").first().isVisible()), "실패 이유가 보인다")
  ok(await until(async () => (await page.locator(`[data-message-id] :text("${failText}")`).count()) === 0), "실패한 글의 말풍선이 남지 않는다")
  if (OUT) await page.screenshot({ path: path.join(OUT, `queue-${room.name}-실패.png`) })

  // 다시 보내면 한 번 저장된다
  failUpload = false
  holdUpload = 0
  posts.length = 0
  await box.press("Enter")
  ok(await until(() => posts.length === 1), "다시 보내면 간다")
  ok(posts[0]?.content === failText && posts[0]?.fileIds?.length === 1, "글과 사진이 함께 간다")
  await page.waitForTimeout(800)
  await page.unroute("**/api/chat/messages", onMessages)
  await page.unroute("**/api/files", onFiles)
}

await browser.close()
console.log(fails === 0 ? "모두 통과" : `실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
