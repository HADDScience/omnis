/** 점검 스위치 — 값 해석 · 실패 시 off · 캐시 · 통과 규칙. 실행: pnpm test:unit */
import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"

import { decide, isAlwaysOpen, sameSecret } from "./rules"
import { OFF, parseState, readMaintenanceState, resetMaintenanceCache, simulatedState, stateFromEnv } from "./state"
import { maintenancePageHtml } from "./page"

const CONN = { GLOBAL_CONFIG: "https://global-config.vercel.com/ecfg_x?token=t" }
const TOKEN = "0123456789abcdef0123"

beforeEach(() => resetMaintenanceCache())

test("값 — 모양이 맞을 때만 켠다, 나머지는 off", () => {
  assert.deepEqual(parseState({ mode: "banner", message: " 공지 ", updatedAt: "2026-11-06T01:00:00Z" }), {
    mode: "banner",
    message: "공지",
    updatedAt: "2026-11-06T01:00:00Z",
  })
  assert.equal(parseState({ mode: "maintenance" }).mode, "maintenance")
  for (const bad of [undefined, null, "maintenance", [], { mode: "on" }, { mode: "MAINTENANCE" }, { message: "x" }])
    assert.deepEqual(parseState(bad), OFF)
  assert.equal(parseState({ mode: "banner", updatedAt: "어제" }).updatedAt, null)
  assert.equal(parseState({ mode: "banner", message: "가".repeat(500) }).message.length, 200)
})

test("연결 문자열이 없으면 스토어를 부르지 않고 off", async () => {
  assert.deepEqual(await readMaintenanceState({ env: {} }), OFF)
})

test("스토어 오류 · 시간 초과는 off", async () => {
  assert.deepEqual(await readMaintenanceState({ env: CONN, reader: () => Promise.reject(new Error("401")) }), OFF)
  resetMaintenanceCache()
  const slow = () => new Promise((r) => setTimeout(() => r({ mode: "maintenance" }), 3000))
  const started = Date.now()
  assert.deepEqual(await readMaintenanceState({ env: CONN, reader: slow }), OFF)
  assert.ok(Date.now() - started < 2500, "1.5초에서 끊는다")
})

test("캐시 — 정한 나이 안에서는 다시 읽지 않는다, 몰린 요청은 한 번만 읽는다", async () => {
  let reads = 0
  let clock = 1_000_000
  const reader = async () => {
    reads++
    return { mode: "banner", message: `n${reads}` }
  }
  const opts = { env: { ...CONN, MAINTENANCE_CACHE_SECONDS: "30" }, reader, now: () => clock }
  const [a, b, c] = await Promise.all([readMaintenanceState(opts), readMaintenanceState(opts), readMaintenanceState(opts)])
  assert.equal(reads, 1)
  assert.equal(a.message, "n1")
  assert.equal(b, a)
  assert.equal(c, a)
  clock += 29_000
  assert.equal((await readMaintenanceState(opts)).message, "n1")
  assert.equal((await readMaintenanceState({ ...opts, maxAgeSeconds: 5 })).message, "n2", "짧은 나이를 바라는 호출은 새로 읽는다")
  clock += 31_000
  assert.equal((await readMaintenanceState(opts)).message, "n3")
  assert.equal(reads, 3)
})

test("환경변수 흉내가 스토어보다 먼저다", async () => {
  let reads = 0
  const state = await readMaintenanceState({
    env: { ...CONN, MAINTENANCE_MODE: "maintenance", MAINTENANCE_MESSAGE: "배포 중" },
    reader: async () => (reads++, { mode: "off" }),
  })
  assert.equal(state.mode, "maintenance")
  assert.equal(state.message, "배포 중")
  assert.equal(reads, 0)
  assert.equal(stateFromEnv({}), null)
  assert.deepEqual(stateFromEnv({ MAINTENANCE_MODE: "아무거나" }), OFF)
})

test("흉내 쿠키는 MAINTENANCE_ALLOW_SIMULATE=1 에서만", () => {
  const cookie = encodeURIComponent(JSON.stringify({ mode: "banner", message: "x" }))
  assert.equal(simulatedState(cookie, {}), null)
  assert.equal(simulatedState(cookie, { MAINTENANCE_ALLOW_SIMULATE: "1" })?.mode, "banner")
  assert.deepEqual(simulatedState("%%%", { MAINTENANCE_ALLOW_SIMULATE: "1" }), OFF)
})

test("통과 규칙 — API · 정적 자원 · Workflow 는 proxy 밖이다", () => {
  for (const p of ["/api", "/api/health", "/api/status", "/api/tasks", "/.well-known/workflow/v1/step", "/sw.js", "/icon-192.png", "/_next/static/a.js", "/manifest.webmanifest"])
    assert.ok(isAlwaysOpen(p), p)
  for (const p of ["/", "/login", "/tasks/abc", "/apix", "/chat/default-room"])
    assert.ok(!isAlwaysOpen(p), p)
})

test("판정 — 화면은 점검 화면, 우회 쿠키는 통과", () => {
  assert.equal(decide({ pathname: "/tasks" }).action, "page")
  assert.equal(decide({ pathname: "/" }).action, "page")
  assert.equal(decide({ pathname: "/api/health" }).action, "pass")
  assert.equal(decide({ pathname: "/tasks", bypassCookie: TOKEN, bypassToken: TOKEN }).action, "pass")
  assert.equal(decide({ pathname: "/tasks", bypassQuery: TOKEN, bypassToken: TOKEN }).action, "grant-bypass")
  assert.equal(decide({ pathname: "/tasks", bypassCookie: "틀림", bypassToken: TOKEN }).action, "page")
  // 토큰이 없거나 짧으면 우회가 아예 없다 — 빈 쿠키로 통과하지 못하게
  assert.equal(decide({ pathname: "/tasks", bypassCookie: "", bypassToken: "" }).action, "page")
  assert.equal(decide({ pathname: "/tasks", bypassCookie: "short", bypassToken: "short" }).action, "page")
  assert.ok(!sameSecret(undefined, TOKEN))
})

test("점검 화면 — 문구를 이스케이프한다", () => {
  const html = maintenancePageHtml({ message: '<script>alert(1)</script>"', updatedAt: null, retryAfterSeconds: 120 })
  assert.ok(!html.includes("<script>alert"))
  assert.ok(html.includes("&lt;script&gt;"))
  assert.ok(maintenancePageHtml({ message: "", updatedAt: null, retryAfterSeconds: 120 }).includes("잠시 점검 중입니다"))
})
