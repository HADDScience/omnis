/**
 * 임시 비밀번호 안내의 상태 — 순수 함수(시험: password-notice.test.ts). 기록을 읽는 쪽은 lib/password-state.ts.
 *
 * `ActivityLog`(entity = auth.password, entityId = 사람)의 기록으로 정한다:
 * - `reset`   관리자가 비밀번호를 정했다(scripts/reset-password.ts) → 바꿀 때까지 「해결 안 됨」
 * - `changed` 본인이 바꿨다 → 해결
 * - `snoozed` 안내의 「나중에」 → 그때부터 7일 동안 안내 토스트만 숨긴다. 마이 진입점의 경고 점은 남는다
 * 「나중에」 는 사람별로 서버에 남는다 — 기기 · 브라우저를 바꿔도 7일 동안 다시 뜨지 않는다.
 */
export const PASSWORD_SNOOZE_DAYS = 7
const DAY_MS = 86_400_000

export interface PasswordLog {
  action: string
  createdAt: Date
}

export interface PasswordNotice {
  /** 관리자가 정해 준 비밀번호를 아직 쓴다 — 마이 진입점의 경고 점 */
  pending: boolean
  /** 안내 토스트를 띄운다 — 해결 안 됐고 「나중에」 7일이 지났거나 누른 적 없음 */
  showNotice: boolean
  /** 「나중에」 로 숨긴 안내가 다시 뜨는 시각. 숨기고 있지 않으면 null */
  snoozedUntil: Date | null
}

export function passwordNotice(logs: readonly PasswordLog[], now: Date): PasswordNotice {
  // 가장 최근의 reset · changed 가 해결 여부를 정한다
  const sorted = [...logs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  const decisive = sorted.find((l) => l.action === "reset" || l.action === "changed")
  if (decisive?.action !== "reset") return { pending: false, showNotice: false, snoozedUntil: null }
  // 그 reset 뒤의 「나중에」 만 센다 — 새로 초기화되면 안내가 다시 뜬다
  const snooze = sorted.find((l) => l.action === "snoozed" && l.createdAt.getTime() >= decisive.createdAt.getTime())
  const until = snooze ? new Date(snooze.createdAt.getTime() + PASSWORD_SNOOZE_DAYS * DAY_MS) : null
  const snoozed = until !== null && until.getTime() > now.getTime()
  return { pending: true, showNotice: !snoozed, snoozedUntil: snoozed ? until : null }
}
