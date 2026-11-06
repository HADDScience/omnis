/**
 * 앱 설치 1단계 — 인앱 브라우저(카카오톡 · 네이버 …)에서 연 페이지를 설치가 되는 브라우저로 넘긴다. 순수 함수 — 시험: install-handoff.test.ts
 *
 * 홈 화면 추가는 iOS 는 Safari, Android 는 Chrome 에서 한다(인앱 브라우저에는 그 메뉴가 없다).
 * 넘긴 주소에는 `?install=continue` 를 붙여, 넘어간 브라우저가 바로 2단계(홈 화면에 추가) 안내를 이어서 띄운다.
 *
 * 스킴별 근거(2026-11-06 조사, 실기기 미확인):
 *   - Android Chrome `intent://…;package=com.android.chrome;end` — Chrome 공식 문서(developer.chrome.com/docs/android/intents).
 *     Chrome 이 없으면 `S.browser_fallback_url` 로 같은 주소를 연다
 *   - 카카오톡 `kakaotalk://web/openExternal?url=` — 공식 문서 없음, 널리 쓰이는 사례(devtalk.kakao.com 질문 · 공개 코드).
 *     비동기 응답 뒤에 부르면 안 넘어갔다는 보고가 있어 버튼 누름에서 바로 연다
 *   - LINE `openExternalBrowser=1` — 공식 문서 없음, 사례만
 *   - iOS `x-safari-https://` — Apple 문서 없음. iOS 15 · 17 · 18 에서 됐다는 보고와 막혔다는 보고가 섞여 있다
 */

export type InstallOs = "ios" | "android" | "other"
export type InAppBrowser = "kakaotalk" | "naver" | "line" | "instagram" | "facebook" | "daum" | "band" | "webview"

export interface BrowserEnv {
  os: InstallOs
  /** 인앱 브라우저면 그 이름 */
  inApp: InAppBrowser | null
  /** 홈 화면 추가가 되는 브라우저(iOS Safari · Android Chrome)인가 */
  canInstallHere: boolean
}

export const INSTALL_CONTINUE_PARAM = "install"
export const INSTALL_CONTINUE_VALUE = "continue"

const IN_APP: [InAppBrowser, RegExp][] = [
  ["kakaotalk", /KAKAOTALK/i],
  ["naver", /NAVER\(inapp|NAVER\/|whale.*inapp/i],
  ["line", /\bLine\//],
  ["instagram", /Instagram/],
  ["facebook", /FBAN|FBAV|FB_IAB|FBIOS/],
  ["daum", /DaumApps/],
  ["band", /\bBAND\//],
]

/** UA 와 터치 지점 수로 지금 브라우저를 가른다. iPadOS 는 데스크톱 Safari 로 위장해 터치로 가른다 */
export function detectBrowser(ua: string, maxTouchPoints = 0): BrowserEnv {
  const os: InstallOs = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)
    ? "ios"
    : /Android/.test(ua)
      ? "android"
      : "other"
  let inApp: InAppBrowser | null = IN_APP.find(([, re]) => re.test(ua))?.[0] ?? null
  // 이름을 안 밝히는 웹뷰 — Android 는 `; wv)`, iOS 는 Safari/ 토큰이 없는 WebKit
  if (!inApp && os === "android" && /; wv\)/.test(ua)) inApp = "webview"
  if (!inApp && os === "ios" && /AppleWebKit/.test(ua) && !/Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)) inApp = "webview"

  let canInstallHere = false
  if (!inApp && os === "ios") canInstallHere = /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|Whale|YaBrowser/.test(ua)
  if (!inApp && os === "android") canInstallHere = /Chrome\/\d/.test(ua) && !/SamsungBrowser|EdgA|OPR\/|Whale|YaBrowser|Firefox|UCBrowser|MiuiBrowser/.test(ua)
  return { os, inApp, canInstallHere }
}

/** 넘긴 브라우저가 2단계를 이어서 띄우게 표시를 붙인다. 있던 표시 · 해시는 그대로 둔다 */
export function withInstallContinue(href: string): string {
  const url = new URL(href)
  url.searchParams.set(INSTALL_CONTINUE_PARAM, INSTALL_CONTINUE_VALUE)
  return url.toString()
}

/** 2단계를 이어서 띄울 주소인가 */
export function isInstallContinue(search: string): boolean {
  return new URLSearchParams(search).get(INSTALL_CONTINUE_PARAM) === INSTALL_CONTINUE_VALUE
}

/** 표시를 뗀 주소 — 이어 띄운 뒤 주소창에서 지운다(새로고침마다 다시 뜨지 않게) */
export function withoutInstallContinue(href: string): string {
  const url = new URL(href)
  url.searchParams.delete(INSTALL_CONTINUE_PARAM)
  return url.toString()
}

export type HandoffTarget = "safari" | "chrome"

export interface Handoff {
  /** 버튼이 열 주소 */
  href: string
  target: HandoffTarget
  /** 스킴의 근거 — official: 공식 문서, reported: 사례만 */
  basis: "official" | "reported"
}

/**
 * 설치가 되는 브라우저로 같은 페이지를 여는 주소. 이미 그 브라우저이거나 넘길 길이 없으면 null(1단계를 건너뛴다).
 * href 는 지금 페이지 주소. 결과 주소에는 `install=continue` 가 붙어 있다.
 */
export function handoffUrl(href: string, env: BrowserEnv): Handoff | null {
  if (env.canInstallHere || env.os === "other") return null
  const next = withInstallContinue(href)
  const url = new URL(next)
  // 운영은 https 다. 사내망 시험 주소(http)도 같은 길로 넘긴다
  const scheme = url.protocol.replace(/:$/, "")
  if (scheme !== "https" && scheme !== "http") return null

  if (env.os === "android") {
    const fallback = encodeURIComponent(next)
    return {
      href: `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=${scheme};package=com.android.chrome;S.browser_fallback_url=${fallback};end`,
      target: "chrome",
      basis: "official",
    }
  }
  // iOS
  if (env.inApp === "kakaotalk") {
    return { href: `kakaotalk://web/openExternal?url=${encodeURIComponent(next)}`, target: "safari", basis: "reported" }
  }
  if (env.inApp === "line") {
    url.searchParams.set("openExternalBrowser", "1")
    return { href: url.toString(), target: "safari", basis: "reported" }
  }
  return { href: `x-safari-${scheme}://${url.host}${url.pathname}${url.search}${url.hash}`, target: "safari", basis: "reported" }
}
