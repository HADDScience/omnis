// 로그인 뒤 원래 화면으로 — 순수(서버 · 프록시 · 브라우저 공통). 시험: lib/login-return.test.ts
//
// 2026-11-12 핫픽스: 공지 링크(/settings/ai-survey)를 카톡에서 누르면 로그아웃 상태의 브라우저로 열리는 일이 많은데,
// 로그인 화면으로 보낼 때 원래 주소를 넘기지 않아 로그인 뒤 /chat 에 떨어졌다.
// 이제 로그인 화면으로 보낼 때 원래 주소를 callbackUrl 에 싣고(SSO 가 이미 쓰는 이름), 로그인 뒤 그 주소로 보낸다.
//
// 같은 사이트 안의 경로만 받는다 — 그대로 넘기면 로그인 화면이 오픈 리다이렉트가 된다.
//   //evil.com · /\evil.com(브라우저가 다른 호스트로 읽는다), https://evil.com · javascript:… (경로가 아니다),
//   탭 · 줄바꿈 · 공백(브라우저가 지우면 「/	/evil.com」 이 「//evil.com」 이 된다)은 거부한다.

/** 로그인 화면이 읽는 이름 — /sso/authorize 와 같은 규칙 */
export const RETURN_PARAM = "callbackUrl"

/** 프록시가 화면 요청에 붙여 두는 원래 주소(basePath · 쿼리 포함) — 서버 컴포넌트는 요청 경로를 모른다 */
export const RETURN_HEADER = "x-omnis-return-path"

const MAX_LEN = 2048

/** 돌아가도 되는 주소면 그대로, 아니면 null */
export function safeReturnPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_LEN) return null
  // 제어 문자 · 공백 · 역슬래시 — 브라우저가 지우거나 / 로 바꿔 읽어 다른 호스트가 될 수 있다
  if (/[\u0000- \u007f\\]/.test(raw)) return null
  if (!raw.startsWith("/") || raw.startsWith("//")) return null
  // 마지막 확인 — 이 주소를 어느 오리진 위에서 풀어도 같은 오리진이어야 한다
  try {
    const base = "https://same-origin.invalid"
    if (new URL(raw, base).origin !== base) return null
  } catch {
    return null
  }
  // 로그인 화면으로 돌아가면 빙빙 돈다
  if (/^\/(?:[^/?#]+\/)?login(?:[/?#]|$)/.test(raw)) return null
  return raw
}

/**
 * 로그인해야 보이는 화면 — app/(main) 아래 최상위 경로와 비밀번호 바꾸기.
 * app/(main) 에 새 폴더를 만들면 여기에도 넣는다(시험이 폴더 목록과 맞춰 본다).
 */
export const PROTECTED_PREFIXES = ["/calendar", "/chat", "/crm", "/dashboard", "/ip", "/nas", "/omnis", "/reports", "/settings", "/tasks", "/account"] as const

/** basePath 를 뺀 경로 */
export function needsLogin(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

/** Auth.js v5 세션 쿠키(https 면 __Secure- 접두, 크면 .0 · .1 로 나뉜다) */
const SESSION_COOKIE = /^(?:__Secure-)?authjs\.session-token(?:\.\d+)?$/

export function hasSessionCookie(names: Iterable<string>): boolean {
  for (const n of names) if (SESSION_COOKIE.test(n)) return true
  return false
}

/** 로그인 화면 주소(basePath 없이) — 돌아갈 곳이 안전하지 않으면 붙이지 않는다 */
export function loginPath(returnTo: string | null | undefined): string {
  const back = safeReturnPath(returnTo)
  return back ? `/login?${RETURN_PARAM}=${encodeURIComponent(back)}` : "/login"
}
