/**
 * 좁은 뷰포트 실측 — 화면을 320 → 200px 로 좁혀 가며 무엇이 잘리는지 센다.
 *
 * 왜 이 폭인가: 시스템 글꼴 크기는 Chrome 웹 콘텐츠에 적용되지 않는다. 대신
 * Chrome 의 기본 확대/축소(50~200%)와 안드로이드 화면 크기(디스플레이 크기)가
 * **CSS 뷰포트를 좁힌다.** 그래서 "글씨를 키웠다"는 웹에서 "폭이 좁아졌다"로
 * 도착한다. 실기기 하한은 280px 근처(폴드 접힘 + 화면 크기 최대)이고,
 * 200px 은 여유를 둔 값이다.
 *
 * 배경과 함정: mydocs/troubleshootings/narrow-viewport-traps.md
 *
 * ## 쓰는 법
 *
 *   npm run dev                                   # 다른 창에서
 *   AUDIT_USER=이름 AUDIT_PASS=비밀번호 node scripts/narrow-audit.mjs
 *
 * 계정을 주지 않으면 로그인 없이 열리는 경로만 잰다.
 *
 * | 환경변수 | 기본값 | 뜻 |
 * |---|---|---|
 * | `BASE_URL`   | `http://localhost:3000` | 잴 대상 |
 * | `WIDTHS`     | `320,280,240,200`       | 쉼표로 구분한 뷰포트 폭 |
 * | `AUDIT_USER` | (없음)                   | 로그인 이름. 없으면 로그인을 건너뛴다 |
 * | `AUDIT_PASS` | (없음)                   | 비밀번호. 코드에 기본값을 두지 않는다 |
 * | `ROUTES`     | (없음)                   | 쉼표로 경로를 직접 지정. 주면 기본 목록 대신 이것만 |
 * | `OUT_DIR`    | `$TMPDIR/narrow-audit`  | 결과 JSON 과 스크린샷 |
 *
 * ## 무엇을 재는가
 *
 * 1. **가로 오버플로** — 문서가 화면보다 넓은가. 0 이어야 한다
 * 2. **뚫고 나간 요소** — 화면 밖으로 나간 것 중 가장 바깥쪽
 * 3. **잘린 요소** — `overflow: hidden|clip` 이 실제로 잘라낸 양
 * 4. **말줄임** — `text-overflow: ellipsis` · `line-clamp` 로 사라진 양
 * 5. **터치 타깃** — 44px 미만인 버튼·링크
 *
 * 2·3·4 는 "가로 스크롤이 없다"만으로는 안 잡히는 것들이다. 스크롤바가 없어도
 * 내용은 사라질 수 있다.
 */
import { chromium } from "playwright"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const BASE = process.env.BASE_URL ?? "http://localhost:3000"
const WIDTHS = (process.env.WIDTHS ?? "320,280,240,200").split(",").map(Number)
const USER = process.env.AUDIT_USER ?? null
const PASS = process.env.AUDIT_PASS ?? null
const OUT = process.env.OUT_DIR ?? path.join(os.tmpdir(), "narrow-audit")

/** 로그인 없이 열리는 것 / 로그인이 필요한 것 */
const PUBLIC_ROUTES = [["/login", "로그인"]]
const PRIVATE_ROUTES = [
  ["/dashboard", "대시보드"],
  ["/tasks", "업무 목록"],
  ["/tasks/projects", "프로젝트 정리"],
  ["/chat", "채팅"],
  ["/omnis", "옴니스"],
  ["/omnis/ask", "옴니스 질문"],
  ["/reports", "주간보고"],
  ["/settings", "설정"],
  ["/nas", "NAS"],
  ["/crm", "CRM 홈"],
  ["/crm/orgs", "거래처 목록"],
  ["/crm/quotes", "견적 목록"],
  ["/crm/quotes/new", "견적 작성"],
  ["/crm/samples", "샘플 목록"],
  ["/crm/samples/new", "샘플 신청"],
  ["/crm/inventory", "재고"],
]

/**
 * 페이지 안에서 도는 검사. 브라우저로 통째로 넘어가므로 바깥 변수를 참조하지 않는다.
 */
const PROBE = () => {
  const root = document.documentElement
  const vw = root.clientWidth

  const desc = (el) => {
    const cls = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 6).join(".")
    const txt = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40)
    const id = el.id ? `#${el.id}` : ""
    return `${el.tagName.toLowerCase()}${id}${cls ? "." + cls : ""}${txt ? ` — "${txt}"` : ""}`
  }

  const visible = (el) => {
    const s = getComputedStyle(el)
    if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false
    // 스크린리더 전용 텍스트는 1px 상자에 갇혀 있는 것이 정상이다
    if (el.classList.contains("sr-only") || el.closest(".sr-only")) return false
    if (el.closest('[aria-hidden="true"]')) return false
    const r = el.getBoundingClientRect()
    return r.width > 1 && r.height > 1
  }

  /**
   * 넘쳐도 되는 자리인지. 가로 스크롤 컨테이너(칸반 레일)와 잘라내기로 가둔
   * 컨테이너(로고 마퀴) 안쪽은 의도된 것이라 세지 않는다.
   */
  const inClippedBox = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX
      if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") return true
    }
    return false
  }

  const all = [...document.querySelectorAll("body *")]
  const bleeds = []
  const clipped = []
  const ellipsized = []
  const tiny = []

  for (const el of all) {
    if (!visible(el)) continue
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)

    // 1·2) 화면 밖으로 나간 것 중 가장 바깥쪽만. 부모가 이미 나갔으면 부모가 원인이다
    if (r.right > vw + 1 && r.left < vw - 1 && !inClippedBox(el)) {
      const p = el.parentElement
      const pr = p && p !== document.body ? p.getBoundingClientRect() : null
      if (!(pr && pr.right > vw + 1 && pr.left < vw - 1))
        bleeds.push({ sel: desc(el), over: Math.round(r.right - vw) })
    }

    // 3) overflow 가 실제로 잘라낸 양
    const cut = el.scrollWidth - el.clientWidth
    if (["hidden", "clip"].includes(s.overflowX) && cut > 1 && el.scrollWidth > 0)
      clipped.push({ sel: desc(el), cut, w: Math.round(r.width) })

    // 4) 말줄임으로 사라진 양
    const isTruncate = s.textOverflow === "ellipsis" && s.overflowX !== "visible"
    const isClamp = s.webkitLineClamp && s.webkitLineClamp !== "none"
    if (isTruncate || isClamp) {
      const cutX = el.scrollWidth - el.clientWidth
      const cutY = el.scrollHeight - el.clientHeight
      if (cutX > 1 || cutY > 1) ellipsized.push({ sel: desc(el), cutX, cutY })
    }

    // 5) 44px 미만 터치 타깃
    const tag = el.tagName.toLowerCase()
    const role = el.getAttribute("role")
    if (tag === "button" || tag === "a" || role === "button" || role === "tab") {
      if (r.height >= 8 && r.width >= 8 && (r.height < 44 || r.width < 44))
        tiny.push({ sel: desc(el), w: Math.round(r.width), h: Math.round(r.height) })
    }
  }

  const uniq = (arr) => {
    const seen = new Set()
    return arr.filter((x) => (seen.has(x.sel) ? false : (seen.add(x.sel), true)))
  }

  return {
    // 어느 포인터 모드로 쟀는지 남긴다 — 터치 전용 규칙이 적용됐는지가 여기서 갈린다
    coarse: matchMedia("(pointer: coarse)").matches,
    overflowX: root.scrollWidth - root.clientWidth,
    bleeds: uniq(bleeds).slice(0, 12),
    clipped: uniq(clipped).slice(0, 12),
    ellipsized: uniq(ellipsized).slice(0, 12),
    tiny: uniq(tiny).slice(0, 12),
  }
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })
  // 하이드레이션 전에 누르면 폼이 그냥 안 먹는다 — 화면은 멀쩡해 보인다
  await page.waitForTimeout(2500)
  await page.locator('input[type="text"]').first().fill(USER)
  await page.locator('input[type="password"]').first().fill(PASS)
  await page.getByRole("button", { name: "로그인", exact: true }).click()
  await page.waitForURL("**/dashboard", { timeout: 40_000 })
}

/** 목록 화면에서 상세 경로 하나를 주워 온다 — id 를 밖에서 받지 않기 위해서다. */
async function discoverDetailRoutes(page) {
  const found = []
  for (const [listPath, prefix, label] of [
    ["/tasks", "/tasks/", "업무 상세"],
    ["/crm/orgs", "/crm/orgs/", "거래처 상세"],
    ["/crm/quotes", "/crm/quotes/", "견적 상세"],
  ]) {
    try {
      await page.goto(BASE + listPath, { waitUntil: "domcontentloaded", timeout: 45_000 })
      await page.waitForTimeout(1500)
      const href = await page.evaluate((pre) => {
        const skip = ["new", "projects"]
        for (const a of document.querySelectorAll("a[href]")) {
          const h = a.getAttribute("href") ?? ""
          if (!h.startsWith(pre)) continue
          const rest = h.slice(pre.length)
          if (!rest || rest.includes("/") || skip.includes(rest)) continue
          return h
        }
        return null
      }, prefix)
      if (href) found.push([href, label])
    } catch {
      // 목록이 비어 있으면 상세를 못 잰다. 그것도 결과다 — 조용히 건너뛴다
    }
  }
  return found
}

const results = []
/**
 * 기본 headless shell 이 없는 환경이 있다(`npx playwright install chromium` 을
 * 안 돌린 경우). 전체 chromium 빌드가 있으면 그쪽으로 떨어진다.
 */
const browser = await chromium
  .launch()
  .catch(() => chromium.launch({ channel: "chromium" }))
const context = await browser.newContext({
  viewport: { width: WIDTHS[0], height: 740 },
  deviceScaleFactor: 1,
  // isMobile 을 켜면 chromium 이 (pointer: coarse) 를 주지 않는다 — 실측 확인.
  // 그 상태로 재면 터치 기기 전용 CSS 가 빠진 채로 측정된다.
  hasTouch: true,
  locale: "ko-KR",
})
const page = await context.newPage()

// 로그인은 ROUTES 를 직접 준 경우에도 한다 — 안 그러면 로그인 화면을 재고
// 「깨끗하다」고 보고하게 된다
if (USER && PASS) {
  await login(page)
  console.log(`로그인: ${USER}`)
} else {
  console.log("계정을 주지 않았다. 로그인이 필요한 경로는 로그인 화면이 잡힌다 (AUDIT_USER · AUDIT_PASS)")
}

let routes
if (process.env.ROUTES) {
  routes = process.env.ROUTES.split(",").map((r) => [r.trim(), r.trim()])
} else if (USER && PASS) {
  routes = [...PUBLIC_ROUTES, ...PRIVATE_ROUTES, ...(await discoverDetailRoutes(page))]
} else {
  routes = PUBLIC_ROUTES
}

fs.mkdirSync(path.join(OUT, "shots"), { recursive: true })

for (const width of WIDTHS) {
  await page.setViewportSize({ width, height: 740 })
  for (const [route, label] of routes) {
    try {
      await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 45_000 })
      await page.waitForTimeout(1800) // 클라이언트 렌더 · 데이터 페치
      const r = await page.evaluate(PROBE)
      results.push({ width, route, label, ...r })
      const bad = r.overflowX > 1 || r.bleeds.length > 0 || r.clipped.length > 0
      console.log(
        `${bad ? "✗" : "·"} ${String(width).padStart(3)}px ${label.padEnd(12)} ${route.padEnd(46)}` +
          ` overflow=${r.overflowX} bleed=${r.bleeds.length} clip=${r.clipped.length}` +
          ` ellip=${r.ellipsized.length} tiny=${r.tiny.length}${r.coarse ? "" : "  (coarse=off)"}`,
      )
      if (bad) {
        const name = `${width}-${route.replace(/\//g, "_").slice(0, 60)}.png`
        await page.screenshot({ path: path.join(OUT, "shots", name) })
      }
    } catch (e) {
      const msg = String(e).split("\n")[0]
      results.push({ width, route, label, error: msg })
      console.log(`! ${width}px ${route} — ${msg}`)
    }
  }
}

const jsonPath = path.join(OUT, "narrow-audit.json")
fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2))

const broken = results.filter((r) => !r.error && (r.overflowX > 1 || r.clipped.length > 0))
console.log(`\n결과: ${jsonPath}`)
console.log(`스크린샷: ${path.join(OUT, "shots")}`)
console.log(`잘리거나 넘친 화면: ${broken.length} / ${results.length}`)

await browser.close()
// 깨진 화면이 있으면 0 이 아닌 코드로 끝낸다 — CI 에 걸 때 쓴다
process.exit(broken.length > 0 ? 1 : 0)
