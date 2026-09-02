/**
 * 프로젝트 이름 정규화 — 중복 생성 판정용.
 *
 * 공백·대소문자만 다른 이름은 같은 프로젝트로 본다.
 * 의미가 다른 이름("홈페이지 관리" vs "웹사이트 관리")까지 합치지는 못하므로,
 * 사후 병합 기능이 별도로 필요하다.
 */
export function normalizeProjectName(input: string): string {
  return input.trim().replace(/\s+/g, " ").toLowerCase()
}
