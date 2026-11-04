// 재직 중인 구성원 — 담당자 · 지시자 · 멘션을 새로 고를 수 있는 사람.
//
// 기준은 둘 다다: 계정이 살아 있고(User.isActive) 인력 표에 퇴사로 적혀 있지 않다(StaffProfile.employment).
// 인력 표는 사람이 관리하는 재직 기록이고 계정은 로그인 여부라, 어느 한쪽만 고쳐도 후보에서 빠져야 한다.
// 인력 표에 없는 계정은 isActive 만 본다 — 프로필은 선택이다(데모 계정 · 새 구성원).
//
// 이미 담당인 퇴사자는 데이터도 화면 이름도 그대로 둔다. 막는 것은 「새로 고르기」 뿐이다.
// 브라우저에서도 불러온다 — prisma 를 import 하지 않는다.

/** Prisma where 조각. 다른 조건과 펼쳐 쓴다(`OR` 을 쓰지 않아 호출자의 `OR` 과 부딪히지 않는다) */
export const ACTIVE_MEMBER_WHERE = {
  isActive: true,
  NOT: { staffProfile: { is: { employment: "FORMER" } } },
} as const

/** 메모리 판정 — ACTIVE_MEMBER_WHERE 와 같은 기준 */
export function isActiveMember(user: { isActive: boolean; staffProfile?: { employment: string } | null }): boolean {
  return user.isActive && user.staffProfile?.employment !== "FORMER"
}

/**
 * 재직 여부를 따로 확인해야 하는 id — 이번에 새로 들어온 사람만.
 * 이미 담당인 퇴사자를 남겨 둔 채 다른 사람을 더해도 저장이 막히지 않게 한다.
 */
export function newlyChosen(next: string[], previous: string[]): string[] {
  const kept = new Set(previous)
  return [...new Set(next)].filter((id) => !kept.has(id))
}

export interface PersonOption {
  id: string
  name: string
  /** 재직자가 아닌데 이 업무에 이미 걸려 있어 목록에 남긴 사람 */
  former?: boolean
}

/**
 * 업무 편집 화면의 후보 — 재직자 + 이 업무에 이미 걸린 사람.
 * 이미 걸린 퇴사자를 빼면 칩이 사라져 다른 칸만 고쳐도 담당에서 조용히 빠진다.
 * 뒤에 표시를 달아 붙인다: 고칠 수는 있어도 새로 고르는 후보가 아니다.
 */
export function personOptions(active: { id: string; name: string }[], current: { id: string; name: string }[]): PersonOption[] {
  const activeIds = new Set(active.map((u) => u.id))
  const seen = new Set<string>()
  const former: PersonOption[] = []
  for (const u of current) {
    if (activeIds.has(u.id) || seen.has(u.id)) continue
    seen.add(u.id)
    former.push({ id: u.id, name: u.name, former: true })
  }
  return [...active, ...former]
}
