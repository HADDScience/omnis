// 국가과제 결정 — public.GrantDecision 에 기댄다. 쓰기는 기존 도구(add · update · remove_grant_decision)로만.
import { defineType } from "../define"

export const grantDecisionType = defineType({
  key: "grant_decision",
  label: "국가과제",
  labelPlural: "국가과제",
  storage: "table",
  backing: "public.GrantDecision",
  llmDescription:
    "회사가 지원할지 정했거나 지원한 국가 · 지자체 과제 한 건과 그 상태(준비 → 제출 완료 → 선정됨 / 미선정 → 수행 중 → 완료, 어디서든 중단). 공고 자체는 grant_notice 유형이다.",
  examples: [{ text: "지금 준비 중인 과제 뭐 있어?" }, { text: "선정된 과제 지원금 합계", note: "stage = selected · in_progress · completed" }],
  visibilityPolicy: "inherit",
  fields: [
    { key: "title", label: "과제명", dataType: "text", frame: "title", column: "title", required: true, filterable: true },
    { key: "stage", label: "상태", dataType: "option", optionSetKey: "grant_stage", column: "stage", required: true, filterable: true },
    { key: "stage_reason", label: "상태 사유", dataType: "text", column: "stageReason" },
    { key: "status_raw", label: "옛 상태(원문)", dataType: "text", column: "statusRaw", readOnly: true },
    { key: "submitted_title", label: "제출한 과제명", dataType: "text", column: "submittedTitle" },
    { key: "deadline", label: "마감", dataType: "datetime", column: "deadline", filterable: true, sortable: true },
    { key: "amount", label: "지원금액(원문)", dataType: "text", column: "amount" },
    { key: "selected_on", label: "선정 통보일", dataType: "date", column: "selectedOn" },
    { key: "awarded_amount", label: "확정 지원금", dataType: "money_krw", column: "awardedAmount" },
    { key: "agreement_on", label: "협약일", dataType: "date", column: "agreementOn" },
    { key: "starts_on", label: "수행 시작일", dataType: "date", frame: "startsOn", column: "startsOn", sortable: true },
    { key: "ends_on", label: "수행 종료일", dataType: "date", frame: "endsOn", column: "endsOn", sortable: true },
    { key: "completed_on", label: "완료일", dataType: "date", column: "completedOn" },
    { key: "nas_folder", label: "NAS 폴더", dataType: "text", column: "nasFolder", llmDescription: "NAS 경로. 옴니스 File 이 아니라 file 칸이 아니다" },
    { key: "note", label: "메모", dataType: "longtext", column: "note" },
    { key: "external_key", label: "원천 키", dataType: "text", column: "externalKey", readOnly: true },
    { key: "task", label: "신청 업무", dataType: "ref", refTypeKey: "task", column: "taskId" },
    { key: "project", label: "과제 프로젝트", dataType: "ref", refTypeKey: "project", column: "projectId" },
  ],
  links: [{ key: "owners", label: "담당", toType: "member", via: "table:GrantDecisionOwner" }],
  actions: [
    { key: "add", label: "우리 결정에 올리기", kind: "create", tool: "add_grant_decision", risk: "write" },
    { key: "update", label: "고치기", kind: "update", tool: "update_grant_decision", risk: "write" },
    { key: "remove", label: "내리기", kind: "delete", tool: "remove_grant_decision", risk: "destructive" },
  ],
})
