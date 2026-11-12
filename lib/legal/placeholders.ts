/**
 * 약관 · 개인정보 처리방침의 자리표시 — 서비스 제공자(운영사)는 아직 정하지 않았다(2026-11-11 사용자 결정 보류).
 * 회사 이름 · 대표 · 사업자 정보를 넣지 않고 {{제공자}} 를 그대로 보인다. 정해지면 이 파일에서 채운다.
 * 문의처만 설정값(환경변수 LEGAL_CONTACT — 이메일이나 주소)으로 채우고, 없으면 {{문의처}} 를 보인다. 순수(시험: placeholders.test.ts).
 */
export const PROVIDER_PLACEHOLDER = "{{제공자}}"
export const CONTACT_PLACEHOLDER = "{{문의처}}"

/** 약관 · 처리방침을 고쳐 시행하는 날. 고치면 이 값과 각 문서를 함께 고친다 */
export const LEGAL_EFFECTIVE_DATE = "2026년 11월 11일"

export type LegalContact =
  | { kind: "email"; value: string; href: string }
  | { kind: "url"; value: string; href: string }
  | { kind: "placeholder"; value: string }

/** 설정값 → 문의처. 이메일 · http(s) 주소만 받고, 그 밖이나 비어 있으면 자리표시 */
export function legalContact(raw: string | undefined): LegalContact {
  const v = (raw ?? "").trim()
  if (/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(v)) return { kind: "email", value: v, href: `mailto:${v}` }
  if (/^https?:\/\/[^\s<>"]+$/.test(v)) return { kind: "url", value: v, href: v }
  return { kind: "placeholder", value: CONTACT_PLACEHOLDER }
}
