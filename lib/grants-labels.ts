// 인증 · 국가과제 화면과 도구가 같이 쓰는 이름표. 데이터만 둔다(화면 · 시험 어디서든 읽게).

/**
 * 인증 단계(2026-11-28) — 아카이브 › 인증 탭 · 도구 · 이식이 이 순서를 쓴다.
 * 후보 → 준비 → 신청 → 심사 중 → 보유 → 갱신 필요 → 만료, 어디서든 → 중단.
 * DB 는 text + CHECK(CompanyCertification_status_check) — 값을 바꾸면 마이그레이션의 CHECK 도 같이 바꾼다.
 * 옛 enum CertStatus(HELD · RENEWAL_DUE · CANDIDATE · NOT_ELIGIBLE · EXPIRED)는 20261128100000_cert_stages 가 옮겼다
 * (NOT_ELIGIBLE → STOPPED + 사유). 키는 공통 층에 유형으로 등록할 때(P9) 선택지의 기존 값이 된다 — 바꾸지 않는다.
 */
export const CERT_STAGE_LABEL = {
  CANDIDATE: "후보",
  PREPARING: "준비",
  APPLIED: "신청",
  REVIEWING: "심사 중",
  HELD: "보유",
  RENEWAL_DUE: "갱신 필요",
  EXPIRED: "만료",
  STOPPED: "중단",
} as const
export type CertStage = keyof typeof CERT_STAGE_LABEL
export const CERT_STAGES = Object.keys(CERT_STAGE_LABEL) as CertStage[]
export const isCertStage = (v: unknown): v is CertStage =>
  typeof v === "string" && (CERT_STAGES as string[]).includes(v)
/** DB 값(text) → 단계. CHECK 가 막지만 모르는 값이면 후보로 본다 */
export const asCertStage = (s: string): CertStage => (isCertStage(s) ? s : "CANDIDATE")
/** 화면 · 도구가 새 인증을 올릴 때의 단계 */
export const CERT_START_STAGE: CertStage = "CANDIDATE"

/**
 * 국가과제 결정 상태(2026-11-26 v2) — 화면 · 도구 · 이식이 이 순서를 쓴다.
 * 준비 → 제출 완료 → 선정됨 / 미선정, 선정됨 → 수행 중 → 완료, 어디서든 → 중단.
 * DB 는 text + CHECK(GrantDecision_stage_check) — 값을 바꾸면 마이그레이션의 CHECK 도 같이 바꾼다.
 */
export const GRANT_STAGE_LABEL = {
  PREPARING: "준비",
  SUBMITTED: "제출 완료",
  SELECTED: "선정됨",
  REJECTED: "미선정",
  IN_PROGRESS: "수행 중",
  COMPLETED: "완료",
  STOPPED: "중단",
} as const
export type GrantStage = keyof typeof GRANT_STAGE_LABEL
export const GRANT_STAGES = Object.keys(GRANT_STAGE_LABEL) as GrantStage[]
export const isGrantStage = (v: unknown): v is GrantStage =>
  typeof v === "string" && (GRANT_STAGES as string[]).includes(v)
/** DB 값(text) → 이름표. 모르는 값은 그대로 */
export const stageLabel = (s: string) =>
  isGrantStage(s) ? GRANT_STAGE_LABEL[s] : s
/** DB 값(text) → 상태. CHECK 가 막지만 모르는 값이면 준비로 본다 */
export const asStage = (s: string): GrantStage =>
  isGrantStage(s) ? s : "PREPARING"
/** 과제 후보 「올리기」 · 직접 등록이 시작하는 상태 */
export const GRANT_START_STAGE: GrantStage = "PREPARING"

/** 상태별 칸 — 이 상태들에서 의미가 있다(값이 이미 있으면 다른 상태에서도 보인다) */
export const GRANT_STAGE_FIELDS = {
  selectedOn: ["SELECTED", "IN_PROGRESS", "COMPLETED"],
  awardedAmount: ["SELECTED", "IN_PROGRESS", "COMPLETED"],
  agreementOn: ["IN_PROGRESS", "COMPLETED"],
  startsOn: ["IN_PROGRESS", "COMPLETED"],
  endsOn: ["IN_PROGRESS", "COMPLETED"],
  completedOn: ["COMPLETED"],
} as const satisfies Record<string, readonly GrantStage[]>
export type GrantStageField = keyof typeof GRANT_STAGE_FIELDS
export const GRANT_STAGE_FIELD_LABEL: Record<GrantStageField, string> = {
  selectedOn: "선정 통보일",
  awardedAmount: "확정 지원금",
  agreementOn: "협약일",
  startsOn: "수행 시작일",
  endsOn: "수행 종료일",
  completedOn: "완료일",
}
export const stageFieldShown = (
  field: GrantStageField,
  stage: GrantStage,
  hasValue: boolean
) => hasValue || (GRANT_STAGE_FIELDS[field] as readonly string[]).includes(stage)

/** 원 단위 정수 → 「120,000,000원」 */
export const won = (n: number | bigint | null | undefined) =>
  n === null || n === undefined ? null : `${Number(n).toLocaleString("ko-KR")}원`

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

/**
 * 「YYYY-MM-DD HH:mm」 · 「YYYY-MM-DDTHH:mm」(서울 시각) → Date. 날짜만이면 그날 23:59(그날까지 접수).
 * 빈 값 → null(지운다), 모양이 틀리면 undefined. ISO 문자열(…Z · +09:00)도 받는다
 */
export function parseSeoulMinute(v: unknown): Date | null | undefined {
  if (v === null || v === "") return null
  if (typeof v !== "string") return undefined
  const t = v.trim()
  let d: Date
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) d = new Date(`${t}T23:59:00+09:00`)
  else if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/.test(t)) d = new Date(`${t.replace(" ", "T")}:00+09:00`)
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(t)) d = new Date(t)
  else return undefined
  return Number.isNaN(d.getTime()) ? undefined : d
}

/** Date → 서울 「2026-12-18 16:00」 */
export const seoulMinute = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 16) : null

/** Date → 서울 날짜 2026-11-25 */
export const seoulYmd = (d: Date | string | null | undefined) =>
  d
    ? new Date(d)
        .toLocaleString("sv-SE", { timeZone: "Asia/Seoul" })
        .slice(0, 10)
    : null
