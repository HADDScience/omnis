/**
 * 옴니스가 쓴 시스템 글의 맨 앞 🤖 — 저장 내용의 표식이다(검색 제외 · 고치기 금지 · 사건 줄 판별이 startsWith("🤖") 로 본다).
 * DB 와 판별은 그대로 두고, **화면에 그릴 때만** 이 표식을 떼고 옴니스 아이콘(components/chat/robot-text.tsx)으로 바꾼다.
 * 시험: robot-mark.test.ts
 */
const LEAD = /^\u{1F916}️?[ \t ]*/u

/** 맨 앞 🤖 가 있나(변형 선택자 U+FE0F 가 붙은 꼴도) */
export function hasRobotMark(text: string): boolean {
  return LEAD.test(text)
}

/** 맨 앞 🤖 와 바로 뒤 빈칸만 뗀다. 글 가운데 · 끝의 🤖 와 줄바꿈은 그대로 */
export function stripRobotMark(text: string): string {
  return text.replace(LEAD, "")
}
