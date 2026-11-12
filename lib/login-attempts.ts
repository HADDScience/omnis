/**
 * 로그인 실패 안내 — 남은 시도 횟수와 잠금 시각을 서버(lib/login-guard.ts)가 정하고 화면이 읽는다.
 *
 * 서버는 실패를 `CredentialsSignin` 의 `code` 에 실어 보낸다(Auth.js 가 `?code=` 로 넘긴다):
 *   `fail.<실패 수>.<남은 수>.<그만큼 더 틀리면 풀리는 시각 ms>` · `locked.<풀리는 시각 ms>`
 *
 * 없는 이름도 같은 형식이다 — 횟수는 입력한 이름의 키로 세므로 계정이 있는지와 상관없다.
 * DB 를 모르는 순수 함수라 단위 시험이 그대로 부른다.
 */

export const LOGIN_FAIL_PREFIX = "fail"
export const LOGIN_LOCKED_PREFIX = "locked"

/** 입력한 이름을 조회 · 잠금 키 모두 같은 모양으로 — 앞뒤 공백, 맥에서 온 자모 분리(NFD) */
export function normalizeLoginName(raw: string): string {
  return raw.normalize("NFC").trim()
}

export type LoginAttemptInfo =
  | { locked: true; reason: "account" | "ip"; until: number }
  | { locked: false; fails: number; remaining: number; lockUntil: number }

export interface AttemptLimits {
  account: { max: number; windowMs: number }
  ip: { max: number; windowMs: number }
}

/**
 * 창 안의 실패 시각(오름차순이 아니어도 된다)으로 지금 상태를 낸다.
 * - 잠김: 가장 최근 `max` 번째 실패가 창을 벗어나는 시각에 풀린다
 * - 안 잠김: 지금 남은 횟수만큼 더 틀리면, 창 안의 가장 오래된 실패(없으면 지금)가 벗어날 때 풀린다
 */
export function attemptInfo(input: { accountFails: number[]; ipFails: number[]; now: number; limits: AttemptLimits }): LoginAttemptInfo {
  const { now, limits } = input
  const acct = [...input.accountFails].sort((a, b) => a - b)
  const ip = [...input.ipFails].sort((a, b) => a - b)
  if (acct.length >= limits.account.max) {
    return { locked: true, reason: "account", until: acct[acct.length - limits.account.max] + limits.account.windowMs }
  }
  if (ip.length >= limits.ip.max) {
    return { locked: true, reason: "ip", until: ip[ip.length - limits.ip.max] + limits.ip.windowMs }
  }
  return {
    locked: false,
    fails: acct.length,
    remaining: limits.account.max - acct.length,
    lockUntil: (acct[0] ?? now) + limits.account.windowMs,
  }
}

export function encodeAttemptCode(info: LoginAttemptInfo): string {
  return info.locked
    ? `${LOGIN_LOCKED_PREFIX}.${Math.round(info.until)}`
    : `${LOGIN_FAIL_PREFIX}.${info.fails}.${info.remaining}.${Math.round(info.lockUntil)}`
}

export type ParsedAttemptCode =
  | { kind: "locked"; until: number | null }
  | { kind: "fail"; fails: number; remaining: number; lockUntil: number }
  | { kind: "unknown" }

export function parseAttemptCode(code: string | null | undefined): ParsedAttemptCode {
  if (!code) return { kind: "unknown" }
  const parts = code.split(".")
  const nums = parts.slice(1).map(Number)
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return { kind: "unknown" }
  if (parts[0] === LOGIN_LOCKED_PREFIX) return { kind: "locked", until: nums.length === 1 ? nums[0] : null }
  if (parts[0] === LOGIN_FAIL_PREFIX && nums.length === 3) return { kind: "fail", fails: nums[0], remaining: nums[1], lockUntil: nums[2] }
  return { kind: "unknown" }
}

/** 서울 시각 HH:mm — 초가 남으면 다음 분으로 올린다(「까지」 가 그 전에 풀린다고 읽히지 않게) */
export function seoulClock(ms: number): string {
  const up = Math.ceil(ms / 60_000) * 60_000
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(up)
}

export const WRONG_CREDENTIALS = "이름 또는 비밀번호가 올바르지 않습니다."
export const LOCKED_FALLBACK = "로그인 시도가 너무 많아 잠시 막혔습니다. 15분 뒤 다시 시도하거나 관리자에게 문의하세요."

/** 로그인 화면이 띄울 한 줄 */
export function loginFailMessage(code: string | null | undefined): string {
  const p = parseAttemptCode(code)
  if (p.kind === "locked") {
    return p.until ? `로그인 시도가 너무 많아 ${seoulClock(p.until)}까지 잠겼습니다.` : LOCKED_FALLBACK
  }
  if (p.kind === "fail") {
    return `${WRONG_CREDENTIALS} 실패 ${p.fails}회 · ${p.remaining}번 더 틀리면 ${seoulClock(p.lockUntil)}까지 잠깁니다`
  }
  return WRONG_CREDENTIALS
}
