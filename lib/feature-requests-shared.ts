// 기능 요청 상태 — 화면(클라이언트)과 서버가 함께 쓴다. prisma 를 들이지 않는다.

export const FEATURE_STATUSES = ["NEW", "REVIEW", "DONE"] as const
export type FeatureStatus = (typeof FEATURE_STATUSES)[number]
export const FEATURE_STATUS_LABEL: Record<FeatureStatus, string> = { NEW: "새로", REVIEW: "검토", DONE: "완료" }
export const isFeatureStatus = (v: unknown): v is FeatureStatus => (FEATURE_STATUSES as readonly unknown[]).includes(v)

// ─── 완료 알림 — 요청한 사람에게 「생겼습니다」 ─────────────────────
// 관리자가 완료로 바꿀 때 바뀐 것 한 줄과 써 볼 곳을 적으면, 그 묶음에 요청을 남긴 사람(바꾼 사람 빼고)의 벨 · 푸시로 간다.
// 알림 entityId 는 `<요청 id>:<써 볼 곳>` — lib/schemas/notification.ts notificationHref 가 뒤쪽으로 연다.
// 계획: mydocs/plans/2026-11-17-feature-done-notify.md

export const FEATURE_DONE_NOTIFY_TYPE = "feature_request_done"
export const DONE_CHANGE_MAX = 120
export const DONE_LINK_MAX = 300
export const DONE_REPLY_HINT = "써 보고 불편하면 답장 주세요."
export const DONE_TITLE_PREFIX = "요청하신 기능이 생겼습니다 — "

export interface DoneNotice {
  change: string
  link: string
}

/** 옴니스 안의 경로만 받는다 — 바깥 주소 · `//host` · 역슬래시 · 빈칸은 막는다 */
export function isInternalPath(v: string): boolean {
  return /^\/(?![/\\])[^\s\\]*$/.test(v) && v.length <= DONE_LINK_MAX
}

/** 관리자가 적은 완료 알림 다듬기 — 문제가 있으면 problem */
export function parseDoneNotice(v: unknown): DoneNotice | { problem: string } {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {}
  const change = typeof o.change === "string" ? o.change.replace(/\s+/g, " ").trim() : ""
  const link = typeof o.link === "string" ? o.link.trim() : ""
  if (!change) return { problem: "무엇이 바뀌었는지 한 줄로 적어 주세요" }
  if (change.length > DONE_CHANGE_MAX) return { problem: `바뀐 것은 ${DONE_CHANGE_MAX}자 안으로 적어 주세요` }
  if (!link) return { problem: "바로 써 볼 곳(옴니스 안의 주소)을 적어 주세요" }
  if (!isInternalPath(link)) return { problem: "써 볼 곳은 / 로 시작하는 옴니스 안의 주소여야 합니다(예: /crm)" }
  return { change, link }
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** 벨 · 푸시에 뜨는 글 — 화면 미리보기와 서버가 같은 것을 쓴다 */
export function doneNoticeText(featureTitle: string, notice: DoneNotice): { title: string; content: string } {
  return { title: `${DONE_TITLE_PREFIX}${clip(featureTitle, 60)}`, content: `${notice.change}\n${DONE_REPLY_HINT}` }
}

export function doneEntityId(requestId: string, link: string): string {
  return `${requestId}:${link}`
}

/** entityId → { 요청 id, 써 볼 곳 }. 모양이 틀리면 null */
export function parseDoneEntityId(entityId: string | null): { requestId: string; link: string } | null {
  if (!entityId) return null
  const i = entityId.indexOf(":")
  if (i <= 0) return null
  const link = entityId.slice(i + 1)
  return isInternalPath(link) ? { requestId: entityId.slice(0, i), link } : null
}
