// 기능 요청 상태 — 화면(클라이언트)과 서버가 함께 쓴다. prisma 를 들이지 않는다.

export const FEATURE_STATUSES = ["NEW", "REVIEW", "DONE"] as const
export type FeatureStatus = (typeof FEATURE_STATUSES)[number]
export const FEATURE_STATUS_LABEL: Record<FeatureStatus, string> = { NEW: "새로", REVIEW: "검토", DONE: "완료" }
export const isFeatureStatus = (v: unknown): v is FeatureStatus => (FEATURE_STATUSES as readonly unknown[]).includes(v)
