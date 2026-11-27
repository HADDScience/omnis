// 선택지 묶음 — 기존 Postgres enum · text 값을 소문자 키에 대어 둔다(계획 §2-1).
// 공통 층 입출력은 key, 기존 도구에 넘길 때만 legacyValue. 이름표는 화면이 쓰는 이름표와 같아야 한다 — 시험이 대조한다.
import { defineOptionSet } from "./define"

/** CompanyRecord.kind(enum RecordKind) — 이름표: lib/schemas/company.ts RECORD_KIND_LABEL */
export const recordKind = defineOptionSet({
  key: "record_kind",
  label: "연혁 종류",
  options: [
    { key: "grant", label: "지원사업", legacyValue: "GRANT" },
    { key: "award", label: "수상", legacyValue: "AWARD" },
    { key: "exhibition", label: "학회·전시", legacyValue: "EXHIBITION" },
    { key: "forum", label: "포럼·세미나", legacyValue: "FORUM" },
    { key: "education", label: "교육", legacyValue: "EDUCATION" },
    { key: "networking", label: "네트워킹", legacyValue: "NETWORKING" },
    { key: "internal", label: "내부행사", legacyValue: "INTERNAL" },
    { key: "milestone", label: "주요", legacyValue: "MILESTONE" },
  ],
})

/** CompanyRecord.visibility(enum RecordVisibility) — 공개 범위 토큰: public ↔ [], internal ↔ ["internal"] */
export const recordVisibility = defineOptionSet({
  key: "record_visibility",
  label: "공개범위",
  options: [
    { key: "public", label: "외부 공개 가능", legacyValue: "PUBLIC" },
    { key: "internal", label: "내부용 · 대외비", legacyValue: "INTERNAL" },
  ],
})

/** GrantDecision.stage(text + CHECK GrantDecision_stage_check) — 이름표 · 순서: lib/grants-labels.ts GRANT_STAGE_LABEL */
export const grantStage = defineOptionSet({
  key: "grant_stage",
  label: "국가과제 상태",
  options: [
    { key: "preparing", label: "준비", legacyValue: "PREPARING" },
    { key: "submitted", label: "제출 완료", legacyValue: "SUBMITTED" },
    { key: "selected", label: "선정됨", legacyValue: "SELECTED" },
    { key: "rejected", label: "미선정", legacyValue: "REJECTED" },
    { key: "in_progress", label: "수행 중", legacyValue: "IN_PROGRESS" },
    { key: "completed", label: "완료", legacyValue: "COMPLETED" },
    { key: "stopped", label: "중단", legacyValue: "STOPPED" },
  ],
})

/** CrmOrg.type(enum CrmOrgType) — 이름표: lib/crm.ts ORG_TYPE_LABEL */
export const orgTypeOptions = defineOptionSet({
  key: "org_type",
  label: "기관 종류",
  options: [
    { key: "university", label: "대학", legacyValue: "UNIVERSITY" },
    { key: "research", label: "연구원", legacyValue: "RESEARCH" },
    { key: "company", label: "기업", legacyValue: "COMPANY" },
    { key: "hospital", label: "병원", legacyValue: "HOSPITAL" },
    { key: "other", label: "기타", legacyValue: "OTHER" },
  ],
})

export const OPTION_SETS = [recordKind, recordVisibility, grantStage, orgTypeOptions] as const
