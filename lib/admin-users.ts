/**
 * 관리자 페이지 「사용자」 탭의 규칙 — 순수 함수(시험: admin-users.test.ts). DB 를 읽는 쪽은 lib/admin-users-server.ts.
 *
 * **비밀번호 · 해시 · 로그인 코드 값은 어떤 화면 · API 로도 내보내지 않는다.** 그래서 내보내는 모양(AdminUserRow)을
 * 칸 단위로 고정하고, DB 행을 그 모양으로 옮길 때 허용한 칸만 집어 담는다(toAdminUserRow). 메일은 서버에서 가려서 보낸다.
 */
import { attemptInfo, LOGIN_RESET_ACTIONS } from "./login-attempts"
import { seenOnboardingVersion, type OnboardingSeen } from "./onboarding-version"

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
  onboarding: OnboardingRow
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
  extra: { lastLoginAt: Date | null; social: readonly string[]; tempPassword: boolean; lock: AccountLock; onboarding: OnboardingRow },
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
    onboarding: extra.onboarding,
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

// ─── 온보딩(사용 안내) — 사람별 판 ─────────────────────────────

/** 봤음: 지금 판까지 봤다 · 다시 뜰 예정: 예전 판만 봤다(다음 화면에 뜬다) · 안 봄: 한 번도 마치거나 건너뛰지 않았다 */
export type OnboardingStatus = "seen" | "due" | "never"
export const ONBOARDING_STATUS_LABEL: Record<OnboardingStatus, string> = { seen: "봤음", due: "다시 뜰 예정", never: "안 봄" }

export interface OnboardingRow {
  /** 이 사람이 본 판(lib/onboarding-version.ts 의 seenOnboardingVersion) */
  seen: number
  status: OnboardingStatus
  lastSeenAt: string | null
}

export function onboardingRow(user: OnboardingSeen, current: number, lastSeenAt: Date | null): OnboardingRow {
  const seen = seenOnboardingVersion(user)
  const status: OnboardingStatus = seen >= current ? "seen" : seen === 0 && !user.onboardingCompletedAt ? "never" : "due"
  return { seen, status, lastSeenAt: lastSeenAt ? lastSeenAt.toISOString() : null }
}

/**
 * 관리자가 한 사람에게 하는 조작 → User.onboardingVersion 에 쓸 값. 행을 지우지 않고 이 칸만 바꾼다.
 * - replay(다시 띄우기): 지금 판보다 하나 낮게 → 다음 화면에 뜬다(needsOnboarding). 마친 시각은 그대로
 * - dismiss(끄기): 지금 판 → 이번 판은 본 것으로
 */
export type OnboardingAdminAction = "replay" | "dismiss"
export const onboardingTargetVersion = (action: OnboardingAdminAction, current: number) => (action === "replay" ? Math.max(0, current - 1) : current)
export const ONBOARDING_ADMIN_AUDIT: Record<OnboardingAdminAction, { action: string; verb: string }> = {
  replay: { action: "admin.onboarding_replay_user", verb: "온보딩 다시 띄우기" },
  dismiss: { action: "admin.onboarding_dismiss_user", verb: "온보딩 끄기" },
}
/** 사람이 안내를 마치거나 건너뛴 기록 — 「마지막으로 본 시각」 을 읽는다(공개 활동 기록에는 내보내지 않는다) */
export const ONBOARDING_SEEN_ENTITY = "onboarding.seen"
