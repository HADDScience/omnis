/**
 * 점검(maintenance) 중 어떤 요청을 막고 어떤 요청을 통과시키는가. proxy.ts 가 부른다.
 * next/server 를 부르지 않는다 — 단위 시험(maintenance.test.ts)이 그대로 읽는다.
 *
 * proxy 는 화면(페이지 · RSC) 요청만 받는다 — /api/* 는 matcher 에서 뺐다. 채팅이 3초마다 API 를
 * 부르므로 API 까지 proxy 를 거치면 함수 호출 수가 거의 두 배가 된다(Hobby 월 1,000,000회).
 * 열린 화면은 /api/status 로 점검을 알아채고 스스로 새로고침해 점검 화면으로 간다(notice-banner.tsx).
 */

/** 관리자 우회 쿠키. 값은 MAINTENANCE_BYPASS_TOKEN 과 같아야 한다(저장소에 두지 않는다) */
export const BYPASS_COOKIE = "omnis_maintenance_bypass"
/** 이 쿼리로 한 번 들어오면 우회 쿠키를 심고 같은 주소로 되돌린다(폰에서 쿠키를 직접 못 넣으므로) */
export const BYPASS_QUERY = "maintenance_bypass"
/** 우회 중임을 화면이 알게 하는 표식 쿠키(비밀 아님). 이게 있으면 점검이어도 새로고침하지 않는다 */
export const BYPASS_FLAG_COOKIE = "omnis_maintenance_admin"
/** 우회 쿠키 수명 — 점검 하나를 넘기지 않게 짧게 */
export const BYPASS_MAX_AGE = 12 * 60 * 60

/**
 * 점검 중에도 통과하는 경로. matcher 가 이미 빼지만, 규칙만으로도 맞게 둔다.
 * - /api/ : 위 설명대로 proxy 밖이다(상태 확인 /api/health · /api/status 포함)
 * - /.well-known/ : Workflow 단계 실행(큰 첨부 복사) · OAuth 디스커버리. 막으면 도는 실행이 실패로 끝난다
 */
const ALWAYS_OPEN_PREFIX: readonly string[] = ["/api/", "/.well-known/"]

/** 정적 자원 — 확장자가 있는 마지막 조각(/sw.js · /icon-192.png · /manifest.webmanifest)과 Next 의 자원 */
function isStaticAsset(pathname: string): boolean {
  if (pathname.startsWith("/_next/")) return true
  const last = pathname.slice(pathname.lastIndexOf("/") + 1)
  return /\.[a-z0-9]{2,12}$/i.test(last)
}

export function isAlwaysOpen(pathname: string): boolean {
  return pathname === "/api" || ALWAYS_OPEN_PREFIX.some((p) => pathname.startsWith(p)) || isStaticAsset(pathname)
}

/** 길이가 같을 때 글자마다 비교한다 — 앞에서 틀린 곳을 시간으로 알아내지 못하게 */
export function sameSecret(given: string | undefined, expected: string | undefined): boolean {
  if (!given || !expected || expected.length < 16) return false
  if (given.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

export type MaintenanceDecision =
  | { action: "pass" }
  /** 우회 쿼리가 맞다 — 쿠키를 심고 쿼리를 뺀 주소로 되돌린다 */
  | { action: "grant-bypass" }
  /** 화면 요청 — 정적 점검 페이지(503) */
  | { action: "page" }

export function decide(input: {
  pathname: string
  bypassCookie?: string
  bypassQuery?: string | null
  bypassToken?: string
}): MaintenanceDecision {
  if (isAlwaysOpen(input.pathname)) return { action: "pass" }
  if (sameSecret(input.bypassCookie, input.bypassToken)) return { action: "pass" }
  if (input.bypassQuery && sameSecret(input.bypassQuery, input.bypassToken)) return { action: "grant-bypass" }
  return { action: "page" }
}

/** 점검 화면을 다시 확인하라고 알려 주는 간격(초) — Retry-After */
export const RETRY_AFTER_SECONDS = 120
