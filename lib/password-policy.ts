/**
 * 새 비밀번호 규칙. 화면과 API 가 같은 함수를 쓴다. 시험: password-policy.test.ts
 *
 * 길이만 강하게 본다 — 문자 종류를 섞으라는 규칙은 「규칙 + 숫자 + !」 같은
 * 짐작하기 쉬운 모양을 만든다. bcrypt 는 72바이트 뒤를 버리므로 그보다 길면 받지 않는다.
 */
export const PASSWORD_MIN = 10
export const PASSWORD_MAX_BYTES = 72

export function passwordProblem(next: string, current?: string): string | null {
  if (next.length < PASSWORD_MIN) return `비밀번호는 ${PASSWORD_MIN}자 이상이어야 합니다.`
  if (new TextEncoder().encode(next).length > PASSWORD_MAX_BYTES) return "비밀번호가 너무 깁니다."
  if (/^(.)\1*$/.test(next)) return "같은 글자만 반복한 비밀번호는 쓸 수 없습니다."
  if (current !== undefined && next === current) return "지금 비밀번호와 다른 비밀번호를 입력하세요."
  return null
}
