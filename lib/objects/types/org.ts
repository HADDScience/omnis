// 기관 — public.CrmOrg 에 기댄다. 쓰기는 기존 CRM 도구(create_org · update_org, confirm 확인)로만.
import { defineType } from "../define"

export const orgType = defineType({
  key: "org",
  label: "기관",
  labelPlural: "기관",
  storage: "table",
  backing: "public.CrmOrg",
  llmDescription:
    "회사와 거래하거나 함께 일하는 바깥 기관 — 대학 · 연구원 · 기업 · 병원. 견적 · 샘플 · 출고 · 세금계산서 · 연락처가 기관에 묶인다. 사람은 contact 유형이다.",
  examples: [{ text: "○○대학교 기관 정보 보여줘" }, { text: "병원 기관 목록", note: "type = hospital" }],
  visibilityPolicy: "inherit",
  fields: [
    { key: "name", label: "기관명", dataType: "text", frame: "title", column: "name", required: true, filterable: true },
    { key: "code", label: "기관코드", dataType: "text", column: "code", readOnly: true, llmDescription: "ORG001 꼴. 만들 때 정해진다" },
    { key: "type", label: "종류", dataType: "option", optionSetKey: "org_type", column: "type", filterable: true },
    { key: "biz_reg_no", label: "사업자등록번호", dataType: "text", column: "bizRegNo", filterable: true },
    { key: "address", label: "주소", dataType: "text", column: "address" },
    { key: "note", label: "메모", dataType: "longtext", column: "note" },
    { key: "billing_org", label: "청구처", dataType: "ref", refTypeKey: "org", column: "billingOrgId", llmDescription: "비면 자기 자신이 세금계산서를 받는다" },
  ],
  actions: [
    { key: "create", label: "만들기", kind: "create", tool: "create_org", risk: "write" },
    { key: "update", label: "고치기", kind: "update", tool: "update_org", risk: "write" },
  ],
})
