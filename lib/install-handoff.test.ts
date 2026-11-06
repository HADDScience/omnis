/** 앱 설치 1단계 — 브라우저 판정 · 넘길 주소. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"

import { detectBrowser, handoffUrl, isInstallContinue, withInstallContinue, withoutInstallContinue } from "./install-handoff"

const UA = {
  iosSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  iosKakao: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.8.5",
  iosNaver: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 NAVER(inapp; search; 2000; 12.10.1; 15PRO)",
  iosLine: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.19.0",
  iosChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1",
  iosWebview: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  ipad: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  androidChrome: "Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  androidKakao: "Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36;KAKAOTALK 2410850",
  androidSamsung: "Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
  androidWebview: "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36",
  macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
}
const PAGE = "https://omnis.haddscience.com/settings?tab=notify#top"

test("브라우저 판정 — 설치되는 곳 · 인앱 · 그 밖", () => {
  assert.deepEqual(detectBrowser(UA.iosSafari), { os: "ios", inApp: null, canInstallHere: true })
  assert.deepEqual(detectBrowser(UA.iosKakao), { os: "ios", inApp: "kakaotalk", canInstallHere: false })
  assert.equal(detectBrowser(UA.iosNaver).inApp, "naver")
  assert.equal(detectBrowser(UA.iosLine).inApp, "line")
  assert.deepEqual(detectBrowser(UA.iosChrome), { os: "ios", inApp: null, canInstallHere: false })
  assert.equal(detectBrowser(UA.iosWebview).inApp, "webview")
  assert.deepEqual(detectBrowser(UA.ipad, 5), { os: "ios", inApp: null, canInstallHere: true })
  assert.equal(detectBrowser(UA.ipad, 0).os, "other")
  assert.deepEqual(detectBrowser(UA.androidChrome), { os: "android", inApp: null, canInstallHere: true })
  assert.deepEqual(detectBrowser(UA.androidKakao), { os: "android", inApp: "kakaotalk", canInstallHere: false })
  assert.deepEqual(detectBrowser(UA.androidSamsung), { os: "android", inApp: null, canInstallHere: false })
  assert.equal(detectBrowser(UA.androidWebview).inApp, "webview")
  assert.deepEqual(detectBrowser(UA.macChrome), { os: "other", inApp: null, canInstallHere: false })
})

test("이미 Safari · Chrome 이거나 PC 면 1단계를 건너뛴다", () => {
  assert.equal(handoffUrl(PAGE, detectBrowser(UA.iosSafari)), null)
  assert.equal(handoffUrl(PAGE, detectBrowser(UA.androidChrome)), null)
  assert.equal(handoffUrl(PAGE, detectBrowser(UA.macChrome)), null)
  assert.equal(handoffUrl("file:///settings", detectBrowser(UA.iosKakao)), null)
})

test("iOS 카카오톡은 openExternal, LINE 은 openExternalBrowser, 그 밖은 x-safari-https", () => {
  const kakao = handoffUrl(PAGE, detectBrowser(UA.iosKakao))!
  assert.equal(kakao.target, "safari")
  assert.ok(kakao.href.startsWith("kakaotalk://web/openExternal?url="))
  const opened = decodeURIComponent(kakao.href.split("url=")[1])
  assert.equal(opened, "https://omnis.haddscience.com/settings?tab=notify&install=continue#top")
  const line = handoffUrl(PAGE, detectBrowser(UA.iosLine))!
  assert.equal(line.href, "https://omnis.haddscience.com/settings?tab=notify&install=continue&openExternalBrowser=1#top")
  assert.equal(handoffUrl(PAGE, detectBrowser(UA.iosNaver))!.href, "x-safari-https://omnis.haddscience.com/settings?tab=notify&install=continue#top")
  assert.equal(handoffUrl(PAGE, detectBrowser(UA.iosChrome))!.href, "x-safari-https://omnis.haddscience.com/settings?tab=notify&install=continue#top")
})

test("사내망 http 주소도 같은 길로 — x-safari-http · intent scheme=http", () => {
  const lan = "http://192.168.0.2:3000/settings"
  assert.equal(handoffUrl(lan, detectBrowser(UA.iosNaver))!.href, "x-safari-http://192.168.0.2:3000/settings?install=continue")
  assert.match(handoffUrl(lan, detectBrowser(UA.androidKakao))!.href, /^intent:\/\/192\.168\.0\.2:3000\/settings\?install=continue#Intent;scheme=http;package=com\.android\.chrome;/)
})

test("Android 는 Chrome intent — 패키지 · 되돌아갈 주소", () => {
  for (const ua of [UA.androidKakao, UA.androidSamsung, UA.androidWebview]) {
    const h = handoffUrl(PAGE, detectBrowser(ua))!
    assert.equal(h.target, "chrome")
    assert.equal(h.basis, "official")
    assert.match(h.href, /^intent:\/\/omnis\.haddscience\.com\/settings\?tab=notify&install=continue#Intent;scheme=https;package=com\.android\.chrome;S\.browser_fallback_url=/)
    assert.ok(h.href.endsWith(";end"))
    const fallback = decodeURIComponent(h.href.split("S.browser_fallback_url=")[1].replace(/;end$/, ""))
    assert.equal(fallback, "https://omnis.haddscience.com/settings?tab=notify&install=continue#top")
  }
})

test("이어서 띄울 표시를 붙이고 · 알아보고 · 뗀다", () => {
  assert.equal(withInstallContinue("https://a.b/x?install=continue"), "https://a.b/x?install=continue")
  assert.ok(isInstallContinue("?tab=notify&install=continue"))
  assert.ok(!isInstallContinue("?install=1"))
  assert.equal(withoutInstallContinue("https://a.b/x?tab=1&install=continue#h"), "https://a.b/x?tab=1#h")
})
