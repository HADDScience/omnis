/**
 * iOS Safari 시뮬레이터에서 앱 셸이 화면을 채우는지 잰다. Chromium 에는 없는 증상이라 e2e 로는 잡히지 않는다.
 *
 *   safaridriver -p 4723 &
 *   node scripts/verify-ios-viewport.mjs <시뮬레이터 UDID> [http://localhost:3000]
 *
 * 데모 빌드(빠른 로그인 단추)를 쓴다. 시뮬레이터에 설정 → Safari → 고급 → 원격 자동화를 켜 둔다.
 * 화면 키보드는 이 자동화로 뜨지 않아 재지 않는다.
 */
const [udid, base = "http://localhost:3000"] = process.argv.slice(2)
if (!udid) throw new Error("시뮬레이터 UDID 를 주세요 — xcrun simctl list devices")

const DRIVER = "http://localhost:4723"
const call = async (method, path, body) => {
  const res = await fetch(DRIVER + path, { method, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) })
  const { value } = await res.json()
  if (value?.error) throw new Error(`${path}: ${JSON.stringify(value)}`)
  return value
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const { sessionId } = await call("POST", "/session", {
  capabilities: { alwaysMatch: { browserName: "Safari", platformName: "iOS", "safari:useSimulator": true, "safari:deviceUDID": udid } },
})
const session = `/session/${sessionId}`
const run = (script) => call("POST", `${session}/execute/sync`, { script, args: [] })

try {
  await call("POST", `${session}/url`, { url: `${base}/login` })
  await sleep(4000)
  await run("[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '팀장')?.click()")
  for (let i = 0; i < 40 && !(await run("return location.pathname")).startsWith("/chat"); i++) await sleep(1000)
  await call("POST", `${session}/url`, { url: `${base}/chat/default-room` })
  await sleep(8000)
  const m = await run(`
    // 시뮬레이터의 getBoundingClientRect 는 zoom 좌표라, 화면을 덮는 칸과 재서 화면 px 로 되돌린다
    const cover = document.createElement('div')
    cover.style.cssText = 'position:fixed;top:0;bottom:0;width:1px;visibility:hidden'
    document.body.append(cover)
    const toScreen = innerHeight / cover.getBoundingClientRect().height
    cover.remove()
    const shell = document.querySelector('[data-main-scroll]').parentElement.parentElement
    const badge = document.querySelector('nav button[aria-label="알림"] [data-slot=badge]')
    return {
      inner: innerHeight,
      shellBottom: shell.getBoundingClientRect().bottom * toScreen,
      badgeTop: badge ? badge.getBoundingClientRect().top * toScreen : null,
      uiZoom: getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom').trim(),
    }`)
  console.log(JSON.stringify(m))
  const ok = Math.abs(m.inner - m.shellBottom) <= 1 && (m.badgeTop === null || m.badgeTop >= 0) && m.uiZoom === "1"
  console.log(ok ? "통과" : "실패")
  process.exitCode = ok ? 0 : 1
} finally {
  await call("DELETE", session).catch(() => {})
}
