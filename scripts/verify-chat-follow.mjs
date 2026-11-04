// 옴니스 방 — 답이 흘러 들어올 때 따라가기 · 말풍선 확인(Playwright). 모델은 부르지 않는다:
// 보내기(POST /api/agent/rooms/<id>)를 브라우저 안에서 조금씩 흘리는 SSE 로 바꿔 끼운다(클라이언트 스트림 모킹).
// 실행: TOKEN=$(pnpm exec tsx --env-file=.env scripts/agent-cookie.ts) BASE=http://localhost:3105 node scripts/verify-chat-follow.mjs
// 방은 로컬 스냅샷의 「[화면 확인] 긴 옴니스 대화 45글」(30개 넘는 방) · 「재현 시험 — 한 줄로 인사만 해 줘」 를 이름으로 찾는다.
// 스크린샷은 mydocs/working/omnis-agent/V-*.png
import { chromium } from "playwright"
const BASE = process.env.BASE ?? "http://localhost:3105"
const TOKEN = (process.env.TOKEN ?? "").trim().split("\n").at(-1)
if (!TOKEN) throw new Error("TOKEN 이 없다 — scripts/agent-cookie.ts 로 만든다")
const OUT = "mydocs/working/omnis-agent"
const rooms = await (await fetch(`${BASE}/api/chat/rooms`, { headers: { cookie: `authjs.session-token=${TOKEN}` } })).json()
const roomByName = (n) => rooms.omnis.find((r) => r.name.startsWith(n))?.id ?? (() => { throw new Error(`방 없음: ${n}`) })()
const LONG_ROOM = roomByName("[화면 확인] 긴 옴니스 대화 45글")
const ANSWER_ROOM = roomByName("재현 시험")
let fails = 0
const ok = (c, m) => { console.log(`${c ? "✓" : "✗"} ${m}`); if (!c) fails++ }

// 실제 모델 없이 — POST /api/agent/rooms/<id> 를 조금씩 흘리는 SSE 로 바꾼다(클라이언트 스트림 모킹)
const MOCK = () => {
  const realFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input.url
    if (init?.method === "POST" && /\/api\/agent\/rooms\/[^/]+$/.test(url)) {
      const enc = new TextEncoder()
      let i = 0
      const body = new ReadableStream({
        start(ctrl) {
          const send = (o) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`))
          send({ type: "start-step" })
          const t = setInterval(() => {
            i++
            send({ type: "text-delta", delta: `${i}번째 문단입니다. 저장해 둔 답을 조금씩 흘려 보내는 시험용 스트림이며, 길이를 채우려고 문장을 조금 늘렸습니다.\n\n` })
            if (i >= 70) { clearInterval(t); ctrl.close() }
          }, 120)
        },
      })
      return Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }))
    }
    return realFetch(input, init)
  }
}

const sc = (page) => page.evaluate(() => { const e = document.querySelector('[role=log]').closest('.overflow-y-auto'); return { top: e.scrollTop, h: e.scrollHeight, c: e.clientHeight } })
const gap = (m) => m.h - m.c - m.top
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function run(label, vp, mobile, how) {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: vp, hasTouch: mobile, isMobile: mobile, deviceScaleFactor: 1 })
  await ctx.addCookies([{ name: "authjs.session-token", value: TOKEN, url: BASE }])
  await ctx.addInitScript(MOCK)
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)

  // 1. 답 화면 — 말풍선 없음
  if (how === "wheel") {
    await page.goto(`${BASE}/chat/${ANSWER_ROOM}`, { waitUntil: "networkidle" })
    await sleep(800)
    const bubble = await page.evaluate(() => {
      const el = document.querySelector('[role=log] .mt-4.flex.gap-2\\.5 .min-w-0.flex-1 > div:last-child')
      const cs = el ? getComputedStyle(el) : null
      return cs ? { border: cs.borderTopWidth, bg: cs.backgroundColor } : null
    })
    ok(bubble && bubble.border === "0px" && /rgba\(0, 0, 0, 0\)|transparent/.test(bubble.bg), `[${label}] 옴니스 글에 테두리·배경이 없다 ${JSON.stringify(bubble)}`)
    const mine = await page.evaluate(() => { const e = [...document.querySelectorAll('[role=log] .rounded-br-md')][0]; return e ? getComputedStyle(e).backgroundColor : null })
    ok(mine && !/rgba\(0, 0, 0, 0\)/.test(mine), `[${label}] 내 글은 말풍선 그대로 ${mine}`)
    await page.screenshot({ path: `${OUT}/V-${label}-omnis-answer.png` })
  }

  // 2. 스트리밍 중 따라가기 · 위로 올리면 멈춤
  await page.goto(`${BASE}/chat/${LONG_ROOM}`, { waitUntil: "networkidle" })
  // 개발 서버는 처음 열 때 하이드레이션이 늦다 — 맨 아래에 닿을 때까지 기다린다(닿지 않으면 아래 확인이 실패한다)
  await page.waitForFunction(() => { const e = document.querySelector('[role=log]')?.closest('.overflow-y-auto'); return e && e.scrollHeight - e.clientHeight - e.scrollTop <= 2 }, null, { timeout: 15000 }).catch(() => {})
  let m = await sc(page)
  ok(gap(m) <= 2, `[${label}/${how}] 처음엔 맨 아래 gap=${gap(m)}`)
  await page.locator('textarea[aria-label="옴니스에게 보낼 글"]').fill("스트림 시험 질문입니다")
  await page.waitForFunction(() => !document.querySelector('button[aria-label="보내기"]')?.disabled, null, { timeout: 15000 })
  await page.locator('button[aria-label="보내기"]').click()
  await sleep(1500)
  const m1 = await sc(page)
  ok(gap(m1) <= 2 && m1.h > m.h, `[${label}/${how}] 흘러 드는 동안 맨 아래를 따라간다 gap=${gap(m1)} h ${m.h}->${m1.h}`)
  ok(await page.locator("[data-scroll-bottom]").count() === 0, `[${label}/${how}] 붙어 있을 때 단추 없음`)

  // 위로 올리기 — 입력 방식별
  const box = await page.locator('[role=log]').boundingBox()
  const cx = box.x + Math.min(box.width, vp.width) / 2, cy = Math.min(vp.height / 2, 300)
  if (how === "wheel") { await page.mouse.move(cx, cy); await page.mouse.wheel(0, -700) }
  else if (how === "touch") {
    await cdp.send("Input.synthesizeScrollGesture", { x: cx, y: cy, yDistance: 500, speed: 800, gestureSourceType: "touch" })
  } else {
    await page.mouse.click(cx, cy) // 목록에 초점
    await page.keyboard.press("PageUp"); await page.keyboard.press("PageUp")
  }
  await sleep(300)
  const up0 = await sc(page)
  ok(gap(up0) > 80, `[${label}/${how}] 위로 올렸다 gap=${gap(up0)}`)
  await sleep(2000)
  const up1 = await sc(page)
  ok(Math.abs(up1.top - up0.top) <= 1, `[${label}/${how}] 답이 계속 와도 보던 자리에 머문다 top ${up0.top}->${up1.top}, h ${up0.h}->${up1.h}`)
  ok(up1.h > up0.h, `[${label}/${how}] 그동안 답은 길어졌다`)
  const btn = page.locator("[data-scroll-bottom]")
  ok(await btn.count() === 1, `[${label}/${how}] 「새 답」 단추가 보인다: ${await btn.innerText().catch(() => "-")}`)
  if (how === "wheel") await page.screenshot({ path: `${OUT}/V-${label}-stream-scrolled-up.png` })

  // 단추로 내려가면 다시 따라간다
  await btn.click()
  await sleep(100)
  const d0 = await sc(page)
  ok(gap(d0) <= 2, `[${label}/${how}] 단추를 누르면 맨 아래 gap=${gap(d0)}`)
  await sleep(1500)
  const d1 = await sc(page)
  ok(gap(d1) <= 2 && d1.h > d0.h, `[${label}/${how}] 다시 따라간다 gap=${gap(d1)} h ${d0.h}->${d1.h}`)
  ok(await page.locator("[data-scroll-bottom]").count() === 0, `[${label}/${how}] 단추 사라짐`)

  // 직접 내려도 다시 붙는다: 올렸다가 휠로 내림
  if (how === "wheel") {
    await page.mouse.move(cx, cy); await page.mouse.wheel(0, -700); await sleep(300)
    ok(gap(await sc(page)) > 80, `[${label}] 다시 올림`)
    await page.mouse.wheel(0, 5000); await sleep(1500)
    const r = await sc(page)
    ok(gap(r) <= 80, `[${label}/wheel] 직접 맨 아래로 내리면 다시 따라간다 gap=${gap(r)}`)
    await page.screenshot({ path: `${OUT}/V-${label}-stream-following.png` })
  }
  await browser.close()
}

async function prepend(label, vp, mobile) {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: vp, hasTouch: mobile, isMobile: mobile })
  await ctx.addCookies([{ name: "authjs.session-token", value: TOKEN, url: BASE }])
  const page = await ctx.newPage()
  await page.goto(`${BASE}/chat/${LONG_ROOM}`, { waitUntil: "networkidle" })
  await sleep(800)
  const r = await page.evaluate(async () => {
    const sc = document.querySelector('[role=log]').closest('.overflow-y-auto')
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    sc.scrollTop = 600; await sleep(300)
    const pick = () => { const t = sc.getBoundingClientRect().top; return [...sc.querySelectorAll('[role=log] > *')].find((e) => e.getBoundingClientRect().top >= t + 10) }
    const el = pick(); const n0 = sc.querySelectorAll('[role=log] > *').length
    sc.scrollTop = 100 // < 120 이면 앞 글을 받는다
    const before = el.getBoundingClientRect().top - sc.getBoundingClientRect().top
    await sleep(2500)
    const after = el.getBoundingClientRect().top - sc.getBoundingClientRect().top
    return { before, after, grew: sc.querySelectorAll('[role=log] > *').length - n0 }
  })
  ok(r.grew > 0, `[${label}] 앞 글이 붙었다 (+${r.grew}줄)`)
  ok(Math.abs(r.before - r.after) <= 2, `[${label}] 보던 글의 자리가 튀지 않는다 ${r.before.toFixed(1)} -> ${r.after.toFixed(1)}`)
  await browser.close()
}

for (const [label, vp, mobile] of [["1440", { width: 1440, height: 900 }, false], ["375", { width: 375, height: 760 }, true]]) {
  for (const how of ["wheel", "touch", "keyboard"]) {
    if (how === "keyboard" && mobile) continue
    if (how === "touch" && !mobile) continue
    await run(label, vp, mobile, how)
  }
  await prepend(label, vp, mobile)
}
console.log(fails ? `실패 ${fails}` : "전부 통과")
process.exit(fails ? 1 : 0)
