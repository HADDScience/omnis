// 옴니스 방 첨부 화면 확인(Playwright) — 실제 모델을 부른다(질문 2번). 로컬 dev 에서만 돌린다.
// 실행: TOKEN=$(pnpm exec tsx --env-file=.env scripts/agent-cookie.ts) BASE=http://localhost:3118 OUT=<캡처 폴더> \
//       IMAGE=<표가 든 png> DOC=<짧은 pdf · txt> node scripts/verify-omnis-attach.mjs
//       ONLY=messenger | ONLY=panel | ONLY=fail 로 하나만(messenger 만 모델을 부른다)
//  1. 390x844 · 메신저(/chat/new): ＋ → 파일 업로드 → 칩(올리는 중 → 다 올림) → 「이 파일 내용 요약해 줘」 → 답 · 내 말풍선 아래 파일 카드
//     IMAGE 와 DOC 를 각각 새 대화로
//  2. 1440 · 오른쪽 패널 옴니스 탭: ＋ 가 같은 자리에 있고 칩이 뜬다(보내지 않는다 — 모델을 부르지 않는다), 칩 빼기
import { chromium } from "playwright"

const BASE = process.env.BASE ?? "http://localhost:3118"
const TOKEN = (process.env.TOKEN ?? "").trim().split("\n").at(-1)
if (!TOKEN) throw new Error("TOKEN 이 없다 — scripts/agent-cookie.ts 로 만든다")
const OUT = process.env.OUT ?? "."
const ONLY = process.env.ONLY ?? ""
const QUESTION = process.env.QUESTION ?? "이 파일 내용 요약해 줘"
let fails = 0
const ok = (c, m) => {
  console.log(`${c ? "✓" : "✗"} ${m}`)
  if (!c) fails++
}

async function open(vp, mobile) {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: vp, hasTouch: mobile, isMobile: mobile, deviceScaleFactor: 2 })
  await ctx.addCookies([{ name: "authjs.session-token", value: TOKEN, url: BASE }])
  return { browser, page: await ctx.newPage() }
}

/** ＋ · 입력칸 · 보내기의 크기와 세로 가운데 */
const pill = (page, scope = "body") =>
  page.evaluate((scope) => {
    const root = document.querySelector(scope)
    const r = (el) => (el ? (({ x, y, width, height }) => ({ x: Math.round(x), y: Math.round(y + height / 2), w: Math.round(width), h: Math.round(height) }))(el.getBoundingClientRect()) : null)
    return {
      plus: r(root.querySelector('button[aria-label="추가"]')),
      box: r(root.querySelector('textarea[aria-label="옴니스에게 보낼 글"]')),
      send: r(root.querySelector('button[aria-label="보내기"]')),
    }
  }, scope)

async function askWithFile(file, tag) {
  const { browser, page } = await open({ width: 390, height: 844 }, true)
  await page.goto(`${BASE}/chat/new`, { waitUntil: "networkidle" })
  const p = await pill(page)
  ok(p.plus && p.plus.w === 48 && p.plus.h === 48, `＋ 는 48px 원 (${JSON.stringify(p.plus)})`)
  ok(p.plus && p.send && Math.abs(p.plus.y - p.send.y) <= 1, `＋ · 보내기 세로 가운데가 같다(±1px)`)
  ok(p.plus && p.box && p.plus.x < p.box.x, "＋ 는 알약 안 왼쪽")

  await page.getByRole("button", { name: "추가" }).click()
  await page.getByRole("menuitem", { name: /파일 업로드/ }).waitFor()
  ok(await page.getByRole("menuitem", { name: /시놀로지 파일 연결/ }).isVisible(), "메뉴: 파일 업로드 · 시놀로지 파일 연결(사람 방과 같다)")
  await page.screenshot({ path: `${OUT}/${tag}-1-menu.png` })
  await page.keyboard.press("Escape")

  await page.locator("[data-omnis-file-input]").setInputFiles(file)
  const chip = page.locator("[data-omnis-attachments] [data-attach-status]").first()
  await chip.waitFor()
  const first = await chip.getAttribute("data-attach-status")
  if (first === "uploading") await page.screenshot({ path: `${OUT}/${tag}-2-uploading.png` })
  await page.locator('[data-omnis-attachments] [data-attach-status="done"]').waitFor({ timeout: 30_000 })
  ok(true, `칩: ${first} → done`)
  await page.screenshot({ path: `${OUT}/${tag}-3-chip.png` })

  await page.getByLabel("옴니스에게 보낼 글").fill(QUESTION)
  const t0 = Date.now()
  const posted = page.waitForResponse((r) => r.url().endsWith("/api/agent/rooms") && r.request().method() === "POST")
  await page.getByRole("button", { name: "보내기" }).click()
  const body = JSON.parse((await posted).request().postData() ?? "{}")
  ok(Array.isArray(body.fileIds) && body.fileIds.length === 1, `질문에 fileIds 1개 (${body.fileIds?.[0]})`)
  await page.waitForURL(/\/chat\/[0-9a-f-]{36}$/, { timeout: 30_000 })
  ok((await page.locator("[data-omnis-attachments] [data-attach-status]").count()) === 0, "보낸 뒤 칩이 비었다")
  await page.locator("[data-agent-live]").waitFor({ timeout: 30_000 }).catch(() => {})
  await page.screenshot({ path: `${OUT}/${tag}-4-streaming.png` })
  await page.locator("[data-agent-live]").waitFor({ state: "detached", timeout: 180_000 })
  await page.getByRole("button", { name: "보내기" }).waitFor({ timeout: 30_000 })
  const answer = await page.evaluate(() => {
    const log = document.querySelector('[role="log"][aria-label="옴니스와의 대화"]')
    const bodies = [...log.querySelectorAll(".omnis-md")]
    return bodies.at(-1)?.innerText ?? ""
  })
  console.log(`  답(${Math.round((Date.now() - t0) / 1000)}초):\n${answer.split("\n").map((l) => `    ${l}`).join("\n")}`)
  ok(answer.length > 20, "옴니스가 답했다")
  // 내 말풍선 아래 파일 카드 — 이미지는 미리보기 img, 나머지는 파일 카드 링크
  const card = await page.evaluate(() => {
    const a = [...document.querySelectorAll('[role="log"] a[href*="/api/files/"]')].at(-1)
    return a ? { href: a.getAttribute("href"), img: !!a.querySelector("img"), text: a.innerText.slice(0, 60) } : null
  })
  ok(!!card, `내 말풍선 아래 파일 카드 ${JSON.stringify(card)}`)
  await page.evaluate(() => {
    const log = document.querySelector('[role="log"][aria-label="옴니스와의 대화"]')
    log.closest(".overflow-y-auto").scrollTop = 0
  })
  await page.screenshot({ path: `${OUT}/${tag}-5-answer-top.png` })
  await page.evaluate(() => {
    const el = document.querySelector('[role="log"]').closest(".overflow-y-auto")
    el.scrollTop = el.scrollHeight
  })
  await page.screenshot({ path: `${OUT}/${tag}-6-answer.png` })
  await page.reload({ waitUntil: "networkidle" })
  ok((await page.locator('[role="log"] a[href*="/api/files/"]').count()) >= 1, "새로고침해도 파일 카드가 남는다(DB 에서)")
  console.log(`  방: ${page.url()}`)
  await browser.close()
  return { answer, card }
}

if (ONLY === "" || ONLY === "messenger") {
  if (process.env.IMAGE) await askWithFile(process.env.IMAGE, "image")
  if (process.env.DOC) await askWithFile(process.env.DOC, "doc")
}

if (ONLY === "" || ONLY === "panel") {
  const { browser, page } = await open({ width: 1440, height: 900 }, false)
  await page.goto(`${BASE}/tasks`, { waitUntil: "networkidle" })
  await page.getByRole("button", { name: /대화 패널 열기/ }).click()
  await page.getByRole("button", { name: "옴니스", exact: true }).click()
  const panel = '[aria-label="대화 패널"]'
  await page.locator(panel).getByLabel("옴니스에게 보낼 글").waitFor({ timeout: 30_000 })
  const p = await pill(page, panel)
  // 패널은 32px(PC 는 html zoom 1.1 이 곱해져 35px 로 잰다) — ＋ 와 보내기가 같은 크기인지 본다
  ok(p.plus && p.send && p.plus.w === p.send.w && p.plus.h === p.send.h && p.plus.w <= 36, `패널: ＋ · 보내기 같은 크기 (${JSON.stringify(p)})`)
  ok(p.plus && p.send && Math.abs(p.plus.y - p.send.y) <= 1, "패널: ＋ · 보내기 세로 가운데가 같다")
  if (process.env.IMAGE) {
    await page.locator(panel).locator("[data-omnis-file-input]").setInputFiles(process.env.IMAGE)
    await page.locator(`${panel} [data-omnis-attachments] [data-attach-status="done"]`).waitFor({ timeout: 30_000 })
    ok(true, "패널: 칩이 뜬다")
    await page.screenshot({ path: `${OUT}/panel-1440-chip.png` })
    await page.locator(panel).getByRole("button", { name: /빼기$/ }).click()
    ok((await page.locator(`${panel} [data-omnis-attachments]`).count()) === 0, "패널: ✕ 로 빼면 칩이 사라진다")
  }
  await browser.close()
}

// 3. 올리기 실패 — 업로드 응답을 500 으로 바꿔 끼운다. 칩이 「실패」 가 되고, 보내기는 막히고, ✕ 로 빼면 풀린다(모델 없음)
if (ONLY === "" || ONLY === "fail") {
  const { browser, page } = await open({ width: 390, height: 844 }, true)
  await page.route("**/api/files", (r) => (r.request().method() === "POST" ? r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "시놀로지에 올리지 못했습니다" }) }) : r.continue()))
  await page.goto(`${BASE}/chat/new`, { waitUntil: "networkidle" })
  await page.locator("[data-omnis-file-input]").setInputFiles(process.env.IMAGE ?? process.env.DOC)
  await page.locator('[data-omnis-attachments] [data-attach-status="error"]').waitFor({ timeout: 15_000 })
  ok(true, "실패: 칩이 「실패」 로 바뀐다")
  await page.getByLabel("옴니스에게 보낼 글").fill(QUESTION)
  ok(await page.getByRole("button", { name: "보내기" }).isDisabled(), "실패한 파일이 있으면 보내기가 막힌다")
  await page.screenshot({ path: `${OUT}/fail-390-chip.png` })
  await page.getByRole("button", { name: /빼기$/ }).click()
  ok(await page.getByRole("button", { name: "보내기" }).isEnabled(), "✕ 로 빼면 다시 보낼 수 있다")
  await browser.close()
}

console.log(fails ? `실패 ${fails}` : "전부 통과")
process.exit(fails ? 1 : 0)
