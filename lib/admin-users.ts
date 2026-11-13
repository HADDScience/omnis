/**
 * 관리자 페이지 「사용자」 탭의 규칙 — 순수 함수(시험: admin-users.test.ts). DB 를 읽는 쪽은 lib/admin-users-server.ts.
 *
 * **비밀번호 · 해시 · 로그인 코드 값은 어떤 화면 · API 로도 내보내지 않는다.** 그래서 내보내는 모양(AdminUserRow)을
 * 칸 단위로 고정하고, DB 행을 그 모양으로 옮길 때 허용한 칸만 집어 담는다(toAdminUserRow). 메일은 서버에서 가려서 보낸다.
 */
import { attemptInfo, LOGIN_RESET_ACTIONS } from "./login-attempts"

/** jwoochang@haddscience.com → jw•••••••@haddscience.com. 앞 두 글자(짧으면 한 글자)만 남긴다 */
export function maskEmail(email: string | null | undefined): string | null {
  const v = email?.trim()
  if (!v) return null
  const at = v.lastIndexOf("@")
  if (at <= 0) return "•••"
  const local = v.slice(0, at)
  const keep = local.length <= 2 ? 1 : 2
  return `${local.slice(0, keep)}${"•".repeat(Math.max(3, local.length - keep))}${v.slice(at)}`
}

export interface LoginLogRow {
  entityId: string | null
  action: string
  createdAt: Date
}

export type AccountLock = { locked: false; fails: number } | { locked: true; until: number }

/**
 * 한 사람의 계정 잠금 — 그 사람으로 들어올 수 있는 키(이름 · 웍스 메일)마다 lib/login-guard.ts 와 같은 규칙으로 센다.
 * 키 하나라도 잠겼으면 잠김(가장 늦게 풀리는 시각). `rows` 는 창 안의 auth.login 기록이면 된다 — 창 밖의 성공은 결과를 바꾸지 않는다.
 * IP 잠금은 사람에 매이지 않아 여기서 다루지 않는다(시간이 지나면 풀린다).
 */
export function accountLock(rows: readonly LoginLogRow[], keys: readonly string[], now: number, limits: { max: number; windowMs: number }): AccountLock {
  let until = 0
  let fails = 0
  for (const key of keys) {
    const mine = rows.filter((r) => r.entityId === key)
    const resetAt = Math.max(
      now - limits.windowMs,
      ...mine.filter((r) => (LOGIN_RESET_ACTIONS as readonly string[]).includes(r.action)).map((r) => r.createdAt.getTime()),
    )
    const accountFails = mine.filter((r) => r.action === "fail" && r.createdAt.getTime() > resetAt).map((r) => r.createdAt.getTime())
    const info = attemptInfo({ accountFails, ipFails: [], now, limits: { account: limits, ip: { max: Number.MAX_SAFE_INTEGER, windowMs: limits.windowMs } } })
    if (info.locked) until = Math.max(until, info.until)
    else fails = Math.max(fails, info.fails)
  }
  return until > 0 ? { locked: true, until } : { locked: false, fails }
}

/** 화면 · API 로 나가는 한 사람의 모양. 여기 없는 칸은 나가지 않는다 */
export interface AdminUserRow {
  id: string
  name: string
  maskedEmail: string | null
  role: "ADMIN" | "MEMBER"
  isActive: boolean
  lastLoginAt: string | null
  social: string[]
  /** 관리자가 정해 준 임시 비밀번호를 아직 쓴다(lib/password-notice.ts 의 pending) */
  tempPassword: boolean
  lock: AccountLock
}

export interface AdminUserSource {
  id: string
  name: string
  email: string | null
  role: string
  isActive: boolean
  [other: string]: unknown
}

export function toAdminUserRow(
  u: AdminUserSource,
  extra: { lastLoginAt: Date | null; social: readonly string[]; tempPassword: boolean; lock: AccountLock },
): AdminUserRow {
  return {
    id: u.id,
    name: u.name,
    maskedEmail: maskEmail(u.email),
    role: u.role === "ADMIN" ? "ADMIN" : "MEMBER",
    isActive: u.isActive,
    lastLoginAt: extra.lastLoginAt ? extra.lastLoginAt.toISOString() : null,
    social: [...extra.social].sort(),
    tempPassword: extra.tempPassword,
    lock: extra.lock,
  }
}

/** 로그인 코드 기록의 종류 — 코드 값(issued 줄의 title 에 든 HMAC)은 읽지도 않는다 */
export const CODE_EVENT_LABEL: Record<string, string> = { issued: "발송", used: "로그인", wrong: "틀림" }
export const CODE_HISTORY_DAYS = 30

/**
 * 감사 기록 탭에 싣는 관리자 행동. entity 가 admin 인 줄(lib/login-guard.ts 의 ADMIN_AUDIT_ENTITY)은 전부,
 * 그 밖에는 관리자만 할 수 있는 API 가 남기는 action 들.
 */
export const ADMIN_AUDIT_ACTIONS = ["onboarding.replayed", "ai_budget.saved", "ai_budget.raised", "feature_request.status"] as const
export const ADMIN_UNLOCK_ACTION = "admin.login_unlocked"
