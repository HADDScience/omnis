// 사용성 수정(2026-10-29 작업지시자 확인 뒤) 화면 확인 — 로컬 dev · 모델을 부르지 않는다.
//   TOKEN=$(pnpm exec tsx --env-file=.env scripts/agent-cookie.ts) BASE=http://localhost:3103 \
//     node scripts/usability-scenarios.mjs [이름 …]
// 스크린샷: mydocs/working/omnis-agent/U-*.png. 이름을 주면 그 장면만.
import { chromium } from "playwright"
import { mkdirSync } from "node:fs"

const BASE = process.env.BASE ?? "http://localhost:3103"
const TOKEN = process.env.TOKEN
if (!TOKEN) throw new Error("TOKEN 이 필요하다 (scripts/agent-cookie.ts)")
const OUT = "mydocs/working/omnis-agent"
mkdirSync(OUT, { recursive: true })
const only = process.argv.slice(2)
const want = (name) => only.length === 0 || only.some((o) => name.includes(o))

const browser = await chromium.launch()
let failed = 0
const check = (label, ok, detail) => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${ok || detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`)
  if (!ok) failed++
}

async function pageAt(width) {
  const phone = width < 700
  const ctx = await browser.newContext({
    viewport: { width, height: phone ? 812 : 900 },
    deviceScaleFactor: phone ? 2 : 1,
    locale: "ko-KR",
    ...(phone ? { hasTouch: true, isMobile: true } : {}),
  })
  await ctx.addCookies([{ name: "authjs.session-token", value: TOKEN, url: BASE }])
  const page = await ctx.newPage()
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message.slice(0, 160)))
  return page
}
async function shot(page, name) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log(`  📷 ${OUT}/${name}.png (가로 넘침 ${overflow}px)`)
  if (overflow > 0) failed++
}
async function open(page, path) {
  await page.goto(BASE + path, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle").catch(() => {})
  await page.waitForTimeout(800)
}

/** 손가락 밀기 — CDP 터치(Playwright 에 swipe 가 없다). 세로 흔들림을 조금 섞는다 */
async function touchSwipe(page, el, dx) {
  const b = await el.boundingBox()
  const cdp = await page.context().newCDPSession(page)
  const y = b.y + b.height / 2
  const x0 = dx < 0 ? b.x + b.width - 30 : b.x + 30
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y }] })
  for (let i = 1; i <= 10; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + (dx * i) / 10, y: y + (i % 2) }] })
    await page.waitForTimeout(16)
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  await page.waitForTimeout(350)
}
/** 꾹 누르기 — 0.7초 */
async function longPress(page, el) {
  const b = await el.boundingBox()
  const cdp = await page.context().newCDPSession(page)
  const p = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p] })
  await page.waitForTimeout(700)
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  await page.waitForTimeout(400)
}
/** 마우스로 끌어 밀기 */
async function mouseSwipe(page, el, dx) {
  const b = await el.boundingBox()
  const y = b.y + b.height / 2
  const x0 = dx < 0 ? b.x + b.width - 40 : b.x + 40
  await page.mouse.move(x0, y)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) await page.mouse.move(x0 + (dx * i) / 10, y)
  await page.mouse.up()
  await page.waitForTimeout(350)
}
const row = (page, kind) => page.locator(`[aria-label="채팅방"] [data-swipe-surface]`).filter({ has: page.locator(kind) }).first()

// ─── 목록: 밀기 · 꾹 누르기 · FAB ───
if (want("list")) {
  console.log("[list] 375 — 밀기 두 방향 · 꾹 누르기 · FAB")
  const page = await pageAt(375)
  await open(page, "/chat")
  const omnisRow = page.locator('[aria-label="채팅방"] [data-swipe-surface]').nth(0)
  const y0 = await page.locator('[aria-label="채팅방"]').evaluate((n) => n.scrollTop)
  await touchSwipe(page, omnisRow, -120)
  check("오른쪽→왼쪽 — 삭제 칸이 드러난다", (await page.locator("[data-swipe-open=right]").count()) === 1)
  check("가로로 밀어도 목록은 세로로 움직이지 않았다", (await page.locator('[aria-label="채팅방"]').evaluate((n) => n.scrollTop)) === y0)
  check("밀어도 방이 열리지 않는다", new URL(page.url()).pathname === "/chat")
  await shot(page, "U-375-swipe-left-delete")
  await page.locator("[data-swipe-open=right] [data-remove-room]").click()
  await page.getByRole("alertdialog").waitFor()
  await shot(page, "U-375-delete-confirm")
  await page.getByRole("button", { name: "취소" }).click()
  await page.waitForTimeout(300)
  // 열린 줄을 누르면 닫기만
  await omnisRow.locator("a").click()
  await page.waitForTimeout(300)
  check("열린 줄을 누르면 닫히고 방은 열리지 않는다", (await page.locator("[data-swipe-open]").count()) === 0 && new URL(page.url()).pathname === "/chat")

  await touchSwipe(page, omnisRow, 160)
  check("왼쪽→오른쪽 — 즐겨찾기 · 폴더 칸", (await page.locator("[data-swipe-open=left]").count()) === 1)
  await shot(page, "U-375-swipe-right-favorite")
  await omnisRow.locator("a").click()
  await page.waitForTimeout(300)

  // 전사방 · 업무방은 오른쪽→왼쪽 동작이 없다
  const companyRow = page.locator('[aria-label="채팅방"] [data-swipe-surface]').filter({ hasText: "하드사이언스" }).first()
  if (await companyRow.count()) {
    await touchSwipe(page, companyRow, -120)
    check("전사방은 오른쪽→왼쪽에 아무것도 없다 (거부되어야 하는 경우)", (await page.locator("[data-swipe-open=right]").count()) === 0)
  }

  // 세로로 밀면 목록이 스크롤되고 줄은 열리지 않는다
  {
    const list = page.locator('[aria-label="채팅방"]')
    const before = await list.evaluate((n) => n.scrollTop)
    const r = await page.locator('[aria-label="채팅방"] [data-swipe-surface]').nth(3).boundingBox()
    const cdp = await page.context().newCDPSession(page)
    const x = r.x + r.width / 2
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: r.y + 300 }] })
    for (let i = 1; i <= 10; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + i, y: r.y + 300 - 25 * i }] })
      await page.waitForTimeout(16)
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    await page.waitForTimeout(500)
    const after = await list.evaluate((n) => n.scrollTop)
    check("세로로 밀면 목록이 스크롤되고 줄은 열리지 않는다", after > before && (await page.locator("[data-swipe-open]").count()) === 0, { before, after })
  }

  // 실제로 지우기 — 재현 시험이 남긴 옴니스 방 하나
  await open(page, "/chat")
  const victim = page.locator('[aria-label="채팅방"] [data-swipe-surface]').filter({ hasText: "재현 시험" }).last()
  if (await victim.count()) {
    const href = await victim.locator("a").getAttribute("href")
    await touchSwipe(page, victim, -120)
    await page.locator("[data-swipe-open=right] [data-remove-room]").click()
    await page.getByRole("alertdialog").getByRole("button", { name: "삭제" }).click()
    await page.getByRole("alertdialog").waitFor({ state: "hidden" })
    await page.waitForTimeout(500)
    check("삭제를 확인하면 그 줄이 목록에서 사라진다", (await page.locator(`[aria-label="채팅방"] a[href="${href}"]`).count()) === 0)
  }
  await open(page, "/chat")
  await longPress(page, page.locator('[aria-label="채팅방"] [data-swipe-surface]').nth(0))
  const menu = page.getByRole("menu")
  check("꾹 누르면 메뉴가 열린다", await menu.isVisible().catch(() => false))
  check("메뉴에 삭제가 있다(키보드 · 롱프레스로도 같은 동작)", (await menu.getByText(/대화 삭제|숨기기|나가기/).count()) > 0)
  check("꾹 눌러도 방이 열리지 않는다", new URL(page.url()).pathname === "/chat")
  await shot(page, "U-375-longpress-menu")
  await page.keyboard.press("Escape")

  await page.locator("[data-new-chat-fab]").click()
  await page.getByRole("menuitem", { name: /옴니스와 대화/ }).waitFor()
  const fab = await page.locator("[data-new-chat-fab]").boundingBox()
  const nav = await page.locator('nav[aria-label="주 메뉴"]').last().boundingBox()
  check("FAB 는 하단 nav 위에 뜬다(겹치지 않는다)", fab.y + fab.height <= nav.y, { fab, nav })
  await shot(page, "U-375-fab-menu")
  await page.close()
}

if (want("pc")) {
  console.log("[pc] 1440 — 마우스 밀기 · 우클릭 · FAB")
  const page = await pageAt(1440)
  await open(page, "/chat")
  const first = page.locator('[aria-label="채팅방"] [data-swipe-surface]').nth(0)
  await mouseSwipe(page, first, -120)
  check("마우스로 끌어도 삭제 칸이 드러난다", (await page.locator("[data-swipe-open=right]").count()) === 1)
  check("끌어도 방이 열리지 않는다", new URL(page.url()).pathname === "/chat")
  await shot(page, "U-1440-swipe-left-delete")
  await first.locator("a").click()
  await page.waitForTimeout(300)
  await mouseSwipe(page, first, 160)
  await shot(page, "U-1440-swipe-right-favorite")
  await first.locator("a").click()
  await page.waitForTimeout(300)
  await first.click({ button: "right" })
  await page.getByRole("menu").waitFor()
  await shot(page, "U-1440-context-menu")
  await page.keyboard.press("Escape")
  await page.waitForTimeout(200)
  // 키보드 — 줄에 초점을 두고 Shift+F10(메뉴 키)
  await first.locator("a").focus()
  await page.keyboard.press("Shift+F10")
  await page.waitForTimeout(300)
  check("키보드 Shift+F10 으로 같은 메뉴가 열린다", await page.getByRole("menu").isVisible().catch(() => false))
  await page.keyboard.press("Escape")
  await page.locator("[data-new-chat-fab]").click()
  await page.getByRole("menuitem", { name: /사람과 대화/ }).waitFor()
  await shot(page, "U-1440-fab-menu")
  await page.close()
}

// ─── 입력칸 ───
if (want("input")) {
  console.log("[input] 375 — 옴니스 방 · 사람 방 · 전사방 입력칸")
  const page = await pageAt(375)
  const align = async (sel, btnSel) =>
    page.evaluate(
      ([s, bs]) => {
        const t = document.querySelector(s)
        const b = document.querySelector(bs)
        if (!t || !b) return null
        const tr = t.getBoundingClientRect()
        const br = b.getBoundingClientRect()
        return { textMid: tr.top + tr.height / 2, btnMid: br.top + br.height / 2, textBottom: tr.bottom, btnBottom: br.bottom }
      },
      [sel, btnSel],
    )
  await open(page, "/chat/new")
  let a = await align('textarea[aria-label="옴니스에게 보낼 글"]', 'button[aria-label="보내기"]')
  check("옴니스 방 — 한 줄일 때 글칸 · 보내기 버튼 세로 가운데가 같다(±1px)", a && Math.abs(a.textMid - a.btnMid) <= 1, a)
  await shot(page, "U-375-input-omnis-one-line")
  const box = page.getByLabel("옴니스에게 보낼 글")
  await box.click()
  await box.press("Enter")
  await box.type("둘째 줄")
  await box.press("Enter")
  await box.type("셋째 줄")
  check("폰에서 Enter 는 줄바꿈 — 보내지 않았다", (await box.inputValue()).split("\n").length === 3 && new URL(page.url()).pathname === "/chat/new")
  a = await align('textarea[aria-label="옴니스에게 보낼 글"]', 'button[aria-label="보내기"]')
  check("여러 줄이면 버튼은 아래에 붙는다", a && Math.abs(a.textBottom - a.btnBottom) <= 6, a)
  await shot(page, "U-375-input-omnis-multiline")

  await open(page, "/chat/default-room")
  a = await align('textarea[aria-label="메시지 입력"]', 'button[aria-label="메시지 전송"]')
  check("전사방 — 한 줄일 때 세로 가운데(±1px)", a && Math.abs(a.textMid - a.btnMid) <= 1, a)
  await shot(page, "U-375-input-company")
  const dm = await page.evaluate(async (base) => {
    const r = await fetch(`${base}/api/chat/rooms`)
    const d = await r.json()
    return d.groups[0]?.id ?? null
  }, BASE)
  if (dm) {
    await open(page, `/chat/${dm}`)
    a = await align('textarea[aria-label="메시지 입력"]', 'button[aria-label="메시지 전송"]')
    check("사람 방 — 한 줄일 때 세로 가운데(±1px)", a && Math.abs(a.textMid - a.btnMid) <= 1, a)
    await shot(page, "U-375-input-people")
  }
  await page.close()

  const pc = await pageAt(1440)
  await open(pc, "/chat/new")
  const pbox = pc.getByLabel("옴니스에게 보낼 글")
  await pbox.click()
  await pbox.type("첫 줄")
  await pbox.press("Shift+Enter")
  await pbox.type("둘째 줄")
  check("PC — Shift+Enter 는 줄바꿈", (await pbox.inputValue()) === "첫 줄\n둘째 줄")
  await shot(pc, "U-1440-input-omnis")
  await pc.close()
}

// ─── 도구 기록 ───
if (want("tools")) {
  console.log("[tools] 도구 기록 — 접힘 · 펼침 (새로고침 뒤 DB 에서)")
  const roomId = process.env.TOOLS_ROOM
  if (!roomId) console.log("  (TOOLS_ROOM 이 없어 건너뜀)")
  else
    for (const w of [1440, 375]) {
      const page = await pageAt(w)
      await open(page, `/chat/${roomId}`)
      const trail = page.locator("[data-tool-trail] button").first()
      check(`${w} — 새로고침 뒤에도 「도구 N개 사용」 이 남는다`, /도구 \d+개 사용/.test(await trail.innerText()))
      await trail.scrollIntoViewIfNeeded()
      await shot(page, `U-${w}-tools-collapsed`)
      await trail.click()
      await page.waitForTimeout(200)
      check(`${w} — 펼치면 도구 이름 · 인자 · 결과`, (await page.locator("[data-tool-trail] ol li").count()) > 0)
      await shot(page, `U-${w}-tools-expanded`)
      await page.close()
    }
}

// ─── 오른쪽 패널 ───
if (want("panel")) {
  console.log("[panel] 오른쪽 패널 — 독 단추 · 탭 셋 · 옴니스")
  for (const w of [1440, 375]) {
    const page = await pageAt(w)
    await open(page, "/tasks")
    check(`${w} — 제목줄에 「채팅 열기」 가 없다`, (await page.locator("header").getByRole("button", { name: /채팅 열기/ }).count()) === 0)
    await shot(page, `U-${w}-panel-dock`)
    await page.getByRole("button", { name: /^대화 패널 열기/ }).click()
    await page.getByRole("tab", { name: "전체" }).waitFor()
    await page.waitForTimeout(1200)
    await shot(page, `U-${w}-panel-all`)
    await page.getByRole("tab", { name: "옴니스" }).click()
    await page.getByLabel("옴니스에게 보낼 글").waitFor({ timeout: 30_000 })
    await page.waitForTimeout(800)
    await shot(page, `U-${w}-panel-omnis`)
    await page.close()
  }
  // 업무 상세 — 「이 업무」 탭
  const page = await pageAt(1440)
  const taskId = await page.evaluate(async (base) => {
    const r = await fetch(`${base}/api/chat/threads/recent`)
    return (await r.json())[0]?.id ?? null
  }, BASE)
  if (taskId) {
    await open(page, `/tasks/${taskId}`)
    await page.getByRole("button", { name: /^대화 패널 열기/ }).click()
    await page.getByRole("tab", { name: "이 업무" }).waitFor()
    check("업무 상세에서 열면 「이 업무」 가 먼저", (await page.getByRole("tab", { name: "이 업무" }).getAttribute("aria-selected")) === "true")
    await page.waitForTimeout(800)
    await shot(page, "U-1440-panel-task")
  }
  await page.close()
}

// ─── 알림 · 마이 ───
if (want("chrome")) {
  console.log("[chrome] 375 — 알림 유리 원 · 폴더 관리 칩 아이콘 가운데")
  const page = await pageAt(375)
  await open(page, "/chat")
  const center = await page.evaluate(() => {
    const out = {}
    for (const [k, sel] of Object.entries({ bell: 'header button[aria-label="알림"]', folder: 'button[aria-label="폴더 관리"]' })) {
      const b = document.querySelector(sel)
      const s = b?.querySelector("svg")
      if (!b || !s) continue
      const br = b.getBoundingClientRect()
      const sr = s.getBoundingClientRect()
      out[k] = { dx: Math.round((sr.left + sr.width / 2 - (br.left + br.width / 2)) * 10) / 10, dy: Math.round((sr.top + sr.height / 2 - (br.top + br.height / 2)) * 10) / 10 }
    }
    return out
  })
  check("폴더 관리 칩 아이콘이 원 가운데(±1px)", center.folder && Math.abs(center.folder.dx) <= 1 && Math.abs(center.folder.dy) <= 1, center.folder)
  check("알림 아이콘이 원 가운데(±1px)", center.bell && Math.abs(center.bell.dx) <= 1 && Math.abs(center.bell.dy) <= 1, center.bell)
  await shot(page, "U-375-chrome")
  await page.close()
}

// ─── 빠르게: 30개씩 · 위로 올려 더 받기 · 기기 저장으로 먼저 그리기 · 두 번 보내기 막기 ───
if (want("speed")) {
  console.log("[speed] 375 — 최근 30개 · 위로 더 · 저장본 먼저 · 누름 즉시")
  const roomId = process.env.PAGED_ROOM
  const page = await pageAt(375)
  if (roomId) {
    await open(page, `/chat/${roomId}`)
    const count = () => page.locator('[role="log"] .omnis-md, [role="log"] .whitespace-pre-wrap').count()
    const first = await count()
    check("처음에는 최근 30개만 그린다", first === 30, first)
    await page.locator("div.overflow-y-auto").filter({ has: page.locator('[role="log"]') }).first().evaluate((n) => (n.scrollTop = 0))
    await page.waitForTimeout(2500)
    const more = await count()
    check("위로 올리면 앞의 글을 더 받는다(45개)", more === 45, more)
    await shot(page, "U-375-paged-older")
    // 목록 → 방: 서버 화면이 오기 전에 저장본이 먼저 보인다
    await open(page, "/chat")
    const link = page.locator(`[aria-label="채팅방"] a[href$="${roomId}"]`)
    const t0 = Date.now()
    await link.click()
    const preview = await page.locator("[data-cached-preview]").waitFor({ timeout: 3000 }).then(() => Date.now() - t0).catch(() => null)
    check("방을 누르면 저장본이 먼저 그려진다", preview !== null, { ms: preview })
    if (preview !== null) {
      console.log(`    저장본까지 ${preview}ms`)
      await shot(page, "U-375-cached-preview")
    }
    await page.locator('[role="log"]').waitFor({ timeout: 30000 })
  }
  // 두 번 누르기 — 보내기 버튼을 같은 순간 두 번(모델을 부르지 않게 2자 미만 · 서버 거부 경로가 아니라 잠금을 본다)
  await open(page, "/chat/default-room")
  const before = await page.evaluate(async (base) => (await (await fetch(`${base}/api/chat/messages?roomId=default-room`)).json()).length, BASE)
  const input = page.getByLabel("메시지 입력")
  const text = `[화면 확인 ${Date.now().toString(36)}] 두 번 누르기`
  await input.fill(text)
  const posts = []
  page.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/api/chat/messages")) posts.push(r.url()) })
  await page.getByRole("button", { name: "메시지 전송" }).evaluate((b) => { b.click(); b.click() })
  await page.waitForTimeout(2500)
  check("보내기를 같은 순간 두 번 눌러도 요청은 한 번", posts.length === 1, { posts: posts.length, before })
  await page.close()
}

await browser.close()
console.log(failed ? `✗ ${failed}건 실패` : "전부 통과")
if (failed) process.exit(1)
