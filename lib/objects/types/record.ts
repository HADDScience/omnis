// 연혁 · 실적 — public.CompanyRecord 에 기댄다. 쓰기는 기존 도구(save_company_record · delete_company_record)로만.
import { defineType } from "../define"

export const recordType = defineType({
  key: "record",
  label: "연혁·실적",
  labelPlural: "연혁·실적",
  storage: "table",
  backing: "public.CompanyRecord",
  llmDescription:
    "회사가 겪은 대외 사건 한 건 — 지원사업 선정, 수상, 학회·전시 참가, 포럼 발표, MOU 체결, 인증 취득 같은 것. 과제 신청서 · 사업계획서의 「연혁 · 주요 실적」 이 된다. 특허 · 상표는 이 유형이 아니다.",
  examples: [{ text: "올해 받은 수상 정리해줘" }, { text: "작년에 참가한 전시회 목록", note: "kind = exhibition" }],
  visibilityPolicy: "column",
  aiPropose: true,
  // lib/record-proposals.ts 의 자동 승인 기준(종류 × 등급별 20건 · 90% · 연속 3건)과 같은 값. 등급 칸은 제안에만 있어 P7 에서 잇는다
  autoApply: { groupBy: ["kind"], minDecided: 20, minRate: 0.9, streak: 3 },
  fields: [
    { key: "title", label: "제목", dataType: "text", frame: "title", column: "title", required: true, filterable: true, aiExtract: true, maxLength: 300 },
    { key: "kind", label: "종류", dataType: "option", optionSetKey: "record_kind", column: "kind", required: true, filterable: true, aiExtract: true },
    { key: "organizer", label: "주관 기관", dataType: "text", column: "organizer", filterable: true, aiExtract: true },
    { key: "starts_on", label: "시작일", dataType: "date", frame: "startsOn", column: "startsOn", filterable: true, sortable: true, aiExtract: true },
    { key: "ends_on", label: "종료일", dataType: "date", frame: "endsOn", column: "endsOn", filterable: true, sortable: true, aiExtract: true },
    { key: "period_raw", label: "기간(원문)", dataType: "text", column: "periodRaw", llmDescription: "원문 기간 표기. 화면은 이것을 보여 준다" },
    { key: "status", label: "진행 상태", dataType: "text", column: "status", filterable: true, llmDescription: "완료 · 진행중 · 발표완료 · 계획 (자유 글)" },
    { key: "subject", label: "과제명 · 주제", dataType: "text", column: "subject", aiExtract: true },
    { key: "role", label: "역할", dataType: "text", column: "role" },
    { key: "funding", label: "지원금", dataType: "money_krw", column: "fundingKrw" },
    { key: "own_cash", label: "자부담(현금)", dataType: "money_krw", column: "ownCashKrw" },
    { key: "own_in_kind", label: "자부담(현물)", dataType: "money_krw", column: "ownInKindKrw" },
    { key: "grant_no", label: "과제번호", dataType: "text", column: "grantNo" },
    { key: "prize", label: "상훈", dataType: "text", column: "prize", aiExtract: true },
    { key: "venue", label: "장소", dataType: "text", column: "venue", aiExtract: true },
    { key: "partner", label: "대리점", dataType: "text", column: "partner", llmDescription: "비면 자사" },
    { key: "category", label: "원문 카테고리", dataType: "text", column: "category", readOnly: true },
    { key: "note", label: "비고", dataType: "longtext", column: "note" },
    { key: "source", label: "출처", dataType: "text", column: "source", readOnly: true, llmDescription: "어느 표에서 왔나" },
    { key: "dedupe_key", label: "중복 키", dataType: "text", column: "dedupeKey", readOnly: true },
    { key: "project", label: "프로젝트", dataType: "ref", refTypeKey: "project", column: "projectId" },
    { key: "visibility", label: "공개범위", dataType: "option", optionSetKey: "record_visibility", frame: "visibility", column: "visibility", filterable: true },
  ],
  actions: [
    { key: "save", label: "남기기 · 고치기", kind: "upsert", tool: "save_company_record", risk: "write" },
    { key: "delete", label: "지우기", kind: "delete", tool: "delete_company_record", risk: "destructive" },
  ],
})
