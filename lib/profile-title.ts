/** 프로필 카드의 직급 · 소셜 아이콘. 순수 함수 — 시험: profile-title.test.ts */

/**
 * 직급 — 인력 표(StaffProfile)의 직급(position, 예: 대표 · 과장 · 인턴). 직급 칸이 비었으면 하드사이언스 겸직 직함(haddRole, 예: CAO).
 * 둘 다 없으면 null — 역할(ADMIN · MEMBER)로 채우지 않는다
 */
export function profileTitle(staff: { position: string | null; haddRole: string | null } | null | undefined): string | null {
  if (!staff) return null
  return staff.position?.trim() || staff.haddRole?.trim() || null
}

const ORDER = ["google", "kakao"] as const

/** 연결된 소셜 — 아는 것만, 겹치지 않게, 늘 같은 순서로 */
export function socialProviders(providers: string[]): (typeof ORDER)[number][] {
  return ORDER.filter((p) => providers.includes(p))
}
