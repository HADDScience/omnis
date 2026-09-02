// 업무 담당자(다대다)를 다루는 공통 조각.
//
// 담당자가 여러 명이 되면서 select·렌더·프롬프트 여러 곳에서 같은 모양을 반복하게 된다.
// 모양이 어긋나면 화면마다 담당자가 다르게 보이므로 여기 한 곳에 둔다.

/** Prisma select 조각 — 담당자를 최소 필드로 가져온다. */
export const assigneesSelect = {
  select: { user: { select: { id: true, name: true } } },
} as const

export interface AssigneeRow {
  user: { id: string; name: string }
}

/** TaskAssignee[] → 화면에서 쓰기 좋은 {id, name}[] */
export function toAssignees(rows: AssigneeRow[]): { id: string; name: string }[] {
  return rows.map((r) => r.user)
}

/**
 * 담당자를 한 줄로 적는다. 좁은 자리(카드·목록)에서 쓴다.
 * 3명을 넘으면 뒤를 접는다 — 이름이 길어지면 정작 업무명이 안 보인다.
 */
export function assigneeLabel(rows: AssigneeRow[], max = 3): string {
  const names = rows.map((r) => r.user.name)
  if (names.length === 0) return "미배정"
  if (names.length <= max) return names.join(", ")
  return `${names.slice(0, max).join(", ")} 외 ${names.length - max}명`
}
