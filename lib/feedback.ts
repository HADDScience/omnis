/**
 * 앱 정보의 「문의·의견 보내기」 — 종류와 기능 요청 제목 만들기. 순수(시험: feedback.test.ts).
 * 보내면 옴니스의 기능 요청(lib/feature-requests.ts)과 같은 곳에 쌓이고 같은 사람에게 알림이 간다.
 */
export const FEEDBACK_KINDS = [
  { id: "idea", label: "의견 · 제안", placeholder: "이렇게 되면 좋겠다 싶은 것을 적어 주세요" },
  { id: "bug", label: "불편 · 오류", placeholder: "어느 화면에서 무엇을 하다가 어떻게 됐는지 적어 주세요" },
  { id: "question", label: "문의", placeholder: "궁금한 것을 적어 주세요" },
] as const
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]["id"]

export function isFeedbackKind(v: unknown): v is FeedbackKind {
  return FEEDBACK_KINDS.some((k) => k.id === v)
}

const TEXT_MAX = 2000

/** 보낼 값 다듬기 — 문제가 있으면 problem */
export function feedbackRequest(kind: unknown, text: unknown): { title: string; detail: string } | { problem: string } {
  if (!isFeedbackKind(kind)) return { problem: "종류를 고르세요" }
  const detail = typeof text === "string" ? text.trim().slice(0, TEXT_MAX) : ""
  if (!detail) return { problem: "내용을 적어 주세요" }
  const label = FEEDBACK_KINDS.find((k) => k.id === kind)!.label
  // 제목은 종류 + 첫 줄 앞부분 — 관리 화면에서 같은 제목끼리 묶인다
  const first = detail.split("\n")[0].trim()
  const head = first.length > 50 ? `${first.slice(0, 49)}…` : first
  return { title: `[${label}] ${head}`, detail }
}
