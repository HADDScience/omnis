// 지원서 단계 이름 — 화면(클라이언트 컴포넌트)에서도 읽는다. node 모듈을 들이지 않는다(rules.ts 는 node:crypto 를 쓴다).
export const STAGE_LABEL = {
  RECEIVING: "올리는 중",
  RECEIVED: "접수",
  SCREENING: "서류",
  INTERVIEW: "면접",
  OFFERED: "합격",
  REJECTED: "불합격",
  WITHDRAWN: "지원 취소",
  HIRED: "입사",
} as const
export type Stage = keyof typeof STAGE_LABEL
