// 푸시 알림 화면 확인 — 설정(마이) · 방 목록 메뉴의 알림 끄기 · 밀기 칸 · 머리줄 표시. 1440 · 375. 모델을 부르지 않는다.
//   TOKEN=$(pnpm exec tsx --env-file=.env scripts/agent-cookie.ts) BASE=http://localhost:3106 ROOM=<옴니스 방 id> \
//     node scripts/notify-screens.mjs
// 스크린샷: mydocs/working/push-notifications/
import { chromium } from "playwright"
import { mkdirSync } from "node:fs"

const BASE = process.env.BASE ?? "http://localhost:3106"
const TOKEN = process.env.TOKEN
const ROOM = process.env.ROOM
if (!TOKEN || !ROOM) throw new Error("TOKEN · ROOM 이 필요하다")
const OUT = "mydocs/working/push-notifications"
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
async function pageAt(width, userAgent) {
  const ctx = await browser.newContext({
    ...(userAgent ? { userAgent } : {}),
    viewport: { width, height: width >= 1000 ? 900 : 812 },
    deviceScaleFactor: width >= 1000 ? 1 : 2,
    locale: "ko-KR",
    hasTouch: width < 1000,
    isMobile: width < 1000,
  })
  await ctx.addCookies([{ name: "authjs.session-token", value: TOKEN, url: BASE }])
  // 온보딩 · 설치 안내가 화면을 덮지 않게
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("omnis.install-card.dismissed", "1")
    } catch {}
  })
  const page = await ctx.newPage()
  page.on("console", (m) => {
    if (m.type() === "error") console.log("  [console]", m.text().slice(0, process.env.FULL_CONSOLE ? 4000 : 200))
  })
  return page
}
const shot = async (page, name, fullPage = false) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage })
  console.log(`  📷 ${OUT}/${name}.png (가로 넘침 ${overflow}px)`)
  return overflow
}

const roomKey = `room:${ROOM}`
async function setMuted(page, muted) {
  const r = await page.request.patch(`${BASE}/api/chat/prefs`, { data: { roomKey, muted } })
  if (!r.ok()) throw new Error(`muted ${muted} 실패 ${r.status()}`)
}

let bad = 0
for (const width of [1440, 375]) {
  console.log(`\n[${width}]`)
  const page = await pageAt(width)

  // 1. 설정 — 기기 알림 탭(이 기기 상태 · 받을 알림 세 스위치)
  await page.goto(`${BASE}/settings`)
  await page.getByText("받을 알림").waitFor()
  await page.locator("[data-notify-kind]").first().waitFor()
  if ((await shot(page, `settings-${width}`, true)) > 0) bad++
  const kinds = await page.locator("[data-notify-kind]").count()
  console.log(`  스위치 ${kinds}개 · 이 기기 상태: ${await page.locator("[data-push-device]").getAttribute("data-push-device")}`)
  if (kinds !== 3) bad++

  // 2. 방 머리줄 — 꺼진 방은 빗금 종
  await setMuted(page, true)
  await page.goto(`${BASE}/chat/${ROOM}`)
  const btn = page.locator("[data-room-muted]")
  await btn.waitFor()
  console.log(`  머리줄 단추: ${await btn.getAttribute("aria-label")} · muted=${await btn.getAttribute("data-room-muted")}`)
  if ((await btn.getAttribute("data-room-muted")) !== "true") bad++
  if ((await shot(page, `header-muted-${width}`)) > 0) bad++

  // 머리줄에서 켜기 → 상태가 바뀐다
  await btn.click()
  await page.waitForFunction(() => document.querySelector("[data-room-muted]")?.getAttribute("data-room-muted") === "false")
  console.log("  머리줄에서 켬 → muted=false")
  await setMuted(page, true)

  // 3. 방 목록 — 꾹 누르기(우클릭) 메뉴의 「알림 켜기 / 끄기」 · 목록의 종 꺼짐 표시
  await page.goto(`${BASE}/chat`)
  const row = page.locator(`a[href$="/chat/${ROOM}"]`).first()
  await row.waitFor()
  // 목록은 기기 저장본으로 먼저 그리고 서버 응답으로 갈아 끼운다 — 꺼짐 표시가 붙을 때까지 기다린다
  await row.locator('[aria-label="알림 꺼짐"]').waitFor({ timeout: 10_000 })
  console.log("  목록 줄에 「알림 꺼짐」 표시")
  if (width >= 1000) {
    await row.click({ button: "right" })
  } else {
    const box = await row.boundingBox()
    await page.dispatchEvent(`a[href$="/chat/${ROOM}"]`, "contextmenu", { clientX: box.x + 40, clientY: box.y + box.height / 2, bubbles: true })
  }
  const item = page.getByRole("menuitem", { name: /알림 (켜기|끄기)/ })
  await item.waitFor()
  console.log(`  메뉴 항목: ${await item.textContent()}`)
  await page.waitForTimeout(400) // 메뉴가 떠오르는 애니메이션이 끝난 뒤 찍는다
  if ((await shot(page, `list-menu-${width}`)) > 0) bad++
  await page.keyboard.press("Escape")

  // 4. 폰 — 왼쪽→오른쪽 밀기 칸(즐겨찾기 · 알림 · 폴더)
  if (width < 1000) {
    const box = await row.boundingBox()
    const y = box.y + box.height / 2
    const x0 = box.x + 20
    // pointer 이벤트로 민다 — 가로가 세로보다 충분히 우세해야 잡는다(swipe-row)
    await page.mouse.move(x0, y)
    await page.mouse.down()
    for (let i = 1; i <= 12; i++) await page.mouse.move(x0 + i * 20, y)
    await page.mouse.up()
    await page.locator("[data-mute-room]").first().waitFor({ state: "visible", timeout: 3000 }).catch(() => {})
    const visible = await page.locator("[data-mute-room]").first().isVisible()
    console.log(`  밀기 칸 알림 단추 보임: ${visible}`)
    if ((await shot(page, `list-swipe-${width}`)) > 0) bad++
  }
  await setMuted(page, false)
  await page.context().close()
}
// 아이폰(사파리 탭) — 홈 화면 앱에서만 된다는 안내가 떠야 한다
{
  console.log("\n[375 · iPhone]")
  const page = await pageAt(375, "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")
  await page.goto(`${BASE}/settings`)
  await page.locator("[data-notify-kind]").first().waitFor()
  const note = page.getByRole("note")
  const shown = await note.isVisible()
  console.log(`  iOS 안내: ${shown ? await note.textContent() : "없음"}`)
  if (!shown) bad++
  if ((await shot(page, "settings-ios-375", true)) > 0) bad++
  await page.context().close()
}
await browser.close()
console.log(bad ? `\n문제 ${bad}건` : "\n문제 없음")
process.exit(bad ? 1 : 0)
