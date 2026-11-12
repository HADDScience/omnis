import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import { PROTECTED_PREFIXES, RETURN_PARAM, hasSessionCookie, loginPath, needsLogin, safeReturnPath } from "./login-return"

test("돌아갈 곳 — 같은 사이트의 경로는 쿼리 · 해시까지 그대로", () => {
  assert.equal(safeReturnPath("/settings/ai-survey"), "/settings/ai-survey")
  assert.equal(safeReturnPath("/tasks/abc?tab=files#c1"), "/tasks/abc?tab=files#c1")
  assert.equal(safeReturnPath("/omnis/settings/ai-survey"), "/omnis/settings/ai-survey")
  assert.equal(safeReturnPath("/sso/authorize?client_id=hub&redirect_uri=https%3A%2F%2Fhub.example"), "/sso/authorize?client_id=hub&redirect_uri=https%3A%2F%2Fhub.example")
  assert.equal(safeReturnPath("/"), "/")
})

test("오픈 리다이렉트 거부 — // · 역슬래시 · 외부 호스트 · javascript: · 제어 문자 · 공백", () => {
  for (const bad of [
    "//evil.com", "//evil.com/settings", "/\\evil.com", "/\\/evil.com", "\\\\evil.com",
    "https://evil.com", "http://omnis.haddscience.com/chat", "javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,x",
    "/\t/evil.com", "/\n/evil.com", "/\r/evil.com", " /chat", "/ /evil.com", "/\u0000",
    "evil.com", "settings", "", null, undefined, `/${"a".repeat(2048)}`,
  ]) assert.equal(safeReturnPath(bad as string | null | undefined), null, JSON.stringify(bad))
  // 인코딩된 것은 같은 사이트 안의 경로로 남는다(브라우저가 이동할 때 풀지 않는다)
  assert.equal(safeReturnPath("/%2F%2Fevil.com"), "/%2F%2Fevil.com")
})

test("로그인 화면으로는 돌아가지 않는다 — 빙빙 돈다", () => {
  assert.equal(safeReturnPath("/login"), null)
  assert.equal(safeReturnPath("/login?callbackUrl=%2Fchat"), null)
  assert.equal(safeReturnPath("/omnis/login"), null)
  assert.equal(safeReturnPath("/loginx"), "/loginx")
})

test("로그인 화면 주소 — 원래 주소를 callbackUrl 로, 안전하지 않으면 붙이지 않는다", () => {
  assert.equal(RETURN_PARAM, "callbackUrl")
  assert.equal(loginPath("/settings/ai-survey"), "/login?callbackUrl=%2Fsettings%2Fai-survey")
  assert.equal(loginPath("/tasks?x=1&y=2"), "/login?callbackUrl=%2Ftasks%3Fx%3D1%26y%3D2")
  assert.equal(loginPath("//evil.com"), "/login")
  assert.equal(loginPath(null), "/login")
  // 왕복 — 로그인 화면이 읽는 값이 원래 주소다
  const q = new URLSearchParams(loginPath("/settings/ai-survey?from=kakao").split("?")[1])
  assert.equal(safeReturnPath(q.get(RETURN_PARAM)), "/settings/ai-survey?from=kakao")
})

test("보호된 화면 — app/(main) 의 최상위 폴더 전부 + 비밀번호 바꾸기, 공개 화면은 아니다", () => {
  const dirs = fs.readdirSync(path.join(process.cwd(), "app/(main)"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => `/${d.name}`)
  for (const d of dirs) assert.ok(needsLogin(d), `${d} 가 PROTECTED_PREFIXES 에 없다`)
  assert.equal(needsLogin("/settings/ai-survey"), true)
  assert.equal(needsLogin("/account/password"), true)
  assert.equal(needsLogin("/chat"), true)
  for (const open of ["/", "/login", "/landing", "/sso/authorize", "/splash", "/privacy", "/chatbot", "/settingsx"]) assert.equal(needsLogin(open), false, open)
  assert.ok(PROTECTED_PREFIXES.every((p) => p.startsWith("/") && !p.endsWith("/")))
})

test("세션 쿠키 — Auth.js 이름(https 접두 · 나뉜 조각)만", () => {
  assert.equal(hasSessionCookie(["authjs.session-token"]), true)
  assert.equal(hasSessionCookie(["__Secure-authjs.session-token"]), true)
  assert.equal(hasSessionCookie(["__Secure-authjs.session-token.0", "__Secure-authjs.session-token.1"]), true)
  assert.equal(hasSessionCookie(["authjs.csrf-token", "authjs.callback-url", "omnis_survey_banner_dismissed"]), false)
  assert.equal(hasSessionCookie([]), false)
})
