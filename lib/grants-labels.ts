// 인증 · 국가과제 화면과 도구가 같이 쓰는 이름표. 데이터만 둔다(화면 · 시험 어디서든 읽게).
import type { CertStatus, GrantStage } from "@/generated/prisma/client"

export const CERT_STATUS_LABEL: Record<CertStatus, string> = {
  HELD: "보유",
  RENEWAL_DUE: "갱신 필요",
  EXPIRED: "만료",
  CANDIDATE: "취득 후보",
  NOT_ELIGIBLE: "자격 안 됨",
}
export const CERT_STATUSES = Object.keys(CERT_STATUS_LABEL) as CertStatus[]

export const GRANT_STAGE_LABEL: Record<GrantStage, string> = {
  REVIEW: "검토",
  PREPARING: "준비",
  SUBMITTED: "제출",
  SELECTED: "선정",
  REJECTED: "미선정",
  DROPPED: "불참",
}
export const GRANT_STAGES = Object.keys(GRANT_STAGE_LABEL) as GrantStage[]

export const VERDICTS = ["해당", "애매", "비해당"] as const
export type Verdict = (typeof VERDICTS)[number]

/** 지역 묶음 — 수집기 region_class 를 화면 필터 셋으로 */
export const REGION_GROUPS = {
  national: { label: "전국", classes: ["national"] },
  gyeonggi: { label: "경기", classes: ["gyeonggi", "gyeonggi_other"] },
  other: { label: "그 밖", classes: ["local", "other_region", "unknown"] },
} as const
export type RegionGroup = keyof typeof REGION_GROUPS

/** 마감 필터 — 서울 날짜 기준 */
export const DEADLINE_FILTERS = {
  open: "접수 중",
  week: "7일 안",
  month: "30일 안",
  all: "전체",
} as const
export type DeadlineFilter = keyof typeof DEADLINE_FILTERS

/** 2026-11-25 형태 → Date(서울 자정). 빈 값은 null, 틀린 값은 undefined */
export function parseYmd(v: unknown): Date | null | undefined {
  if (v === null || v === "") return null
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined
  const d = new Date(`${v}T00:00:00+09:00`)
  return Number.isNaN(d.getTime()) ? undefined : d
}

/** Date → 서울 날짜 2026-11-25 */
export const seoulYmd = (d: Date | string | null | undefined) =>
  d
    ? new Date(d)
        .toLocaleString("sv-SE", { timeZone: "Asia/Seoul" })
        .slice(0, 10)
    : null
