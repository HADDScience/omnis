// 미배정 업무 상세의 「담당자 지정」 칸이 쓰는 판정 · 고르기.
//
// 담당이 비면 알림도 담당자별 화면도 닿지 않는다(lib/task-unassigned.ts). 상세를 연 사람이
// 그 자리에서 한 번 눌러 맡길 수 있게 칸을 띄운다. 저장은 기존 PATCH /api/tasks/[id] 의 assigneeIds —
// 권한 · 알림 · 이력은 그쪽(lib/task-update.ts)이 맡는다.

import { isUnassignedOpen } from "@/lib/task-unassigned"

/** 고를 사람이 이보다 많으면 이름 검색을 띄운다. 지금 인원(10명 안쪽)이면 칩만 보인다 */
export const QUICK_ASSIGN_SEARCH_AT = 12

/** 칸을 띄울지 — 미완료이면서 담당 0명. 완료된 업무는 맡길 일이 없다 */
export function showQuickAssign(task: { status: string; assignees: unknown[] }): boolean {
  return isUnassignedOpen({ status: task.status, assigneeCount: task.assignees.length })
}

/**
 * 칩으로 보일 사람. 과거 구성원은 서버가 새 담당으로 받지 않으니 뺀다(lib/active-members.ts).
 * 검색어는 공백을 무시하고 이름 어디에 있든 맞춘다.
 */
export function quickAssignChoices<T extends { id: string; name: string; former?: boolean }>(choices: T[], query = ""): T[] {
  const q = query.replace(/\s+/g, "").toLowerCase()
  return choices.filter((u) => !u.former && (q === "" || u.name.replace(/\s+/g, "").toLowerCase().includes(q)))
}

// ─── 업무 목록 · 보드의 「담당 지정」(2026-11-10) ─────────────────────────

/** 저장을 기다리는 동안 화면에 먼저 보일 담당 — 업무 id → 고른 사람 */
export type AssignOverrides = Record<string, { id: string; name: string }>

/**
 * 고른 사람을 먼저 그린다. 서버가 이미 담당이 있다고 내려 준 업무에는 덮어쓰지 않는다 — 새로고침 뒤에는 서버 값이 맞다.
 * 덮을 것이 없으면 받은 배열을 그대로 돌려준다(보드는 배열이 바뀌면 끌던 상태를 버린다).
 */
export function withAssignOverrides<T extends { id: string; unassigned?: boolean; ownerName: string | null }>(
  tasks: T[],
  overrides: AssignOverrides,
): T[] {
  if (Object.keys(overrides).length === 0) return tasks
  let changed = false
  const next = tasks.map((t) => {
    const person = overrides[t.id]
    if (!person || !t.unassigned) return t
    changed = true
    return { ...t, unassigned: false, ownerName: person.name }
  })
  return changed ? next : tasks
}

/** 서버 값이 담당 있음으로 따라온 업무의 덮어쓰기를 걷는다. 걷을 것이 없으면 같은 객체 */
export function pruneAssignOverrides(overrides: AssignOverrides, tasks: { id: string; unassigned?: boolean }[]): AssignOverrides {
  const ids = Object.keys(overrides)
  if (ids.length === 0) return overrides
  const stillOpen = new Set(tasks.filter((t) => t.unassigned).map((t) => t.id))
  const keep = ids.filter((id) => stillOpen.has(id))
  if (keep.length === ids.length) return overrides
  return Object.fromEntries(keep.map((id) => [id, overrides[id]]))
}
