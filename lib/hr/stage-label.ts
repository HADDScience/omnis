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

/** 면접자료 PDF 를 받을 수 있는 단계 — 서류 합격(면접 · 합격 통보) · 최종 합격 */
export const PACK_STAGES = ["INTERVIEW", "OFFERED", "HIRED"] as const
/** 공고 보드 「서류 합격」 열 — 묶음에 넣는 단계 */
export const BUNDLE_STAGES = ["INTERVIEW", "OFFERED"] as const
export const canPack = (stage: string) => (PACK_STAGES as readonly string[]).includes(stage)
