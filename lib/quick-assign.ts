// 담당 지정 칸(미배정 업무 상세 · 업무 목록 · 보드 · 폰 시트)이 쓰는 판정 · 고르기. 여러 명을 고른다(2026-11-11).
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

// ─── 여러 명 고르기(2026-11-11) ─────────────────────────────────

type Person = { id: string; name: string }

/** 칩을 눌러 넣고 빼기 — 넣은 순서를 지킨다 */
export function toggleAssignee(selected: readonly string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]
}

/** 저장할 때 바뀌는 것 — 새로 넣은 사람 · 뺀 사람. 서버(lib/task-update.ts)와 화면 안내가 같은 셈을 쓴다 */
export function assigneeDiff(previous: readonly string[], next: readonly string[]): { added: string[]; removed: string[] } {
  const before = new Set(previous)
  const after = new Set(next)
  return {
    added: [...after].filter((id) => !before.has(id)),
    removed: [...before].filter((id) => !after.has(id)),
  }
}

/** 순서와 상관없이 같은 사람들인가 */
export function sameAssignees(a: readonly string[], b: readonly string[]): boolean {
  const d = assigneeDiff(a, b)
  return d.added.length === 0 && d.removed.length === 0
}

/** 저장 단추를 누를 수 있는가 — 바뀐 것이 있고, 한 명 이상(서버가 0명을 받지 않는다) */
export function canSaveAssignees(previous: readonly string[], next: readonly string[]): boolean {
  return next.length > 0 && !sameAssignees(previous, next)
}

/** 저장 뒤 한 줄 안내 — 「가 · 나님 지정 · 다님 해제」 */
export function assignSummary(previous: readonly string[], next: readonly string[], people: readonly Person[]): string {
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? "알 수 없는 사람"
  const { added, removed } = assigneeDiff(previous, next)
  const parts = [
    added.length ? `${added.map(name).join(" · ")}님 지정` : "",
    removed.length ? `${removed.map(name).join(" · ")}님 해제` : "",
  ].filter(Boolean)
  return parts.length ? parts.join(" · ") : "바뀐 담당이 없어요"
}

// ─── 업무 목록 · 보드의 「담당 지정」(2026-11-10, 여러 명 2026-11-11) ──────────

/** 저장을 기다리는 동안 화면에 먼저 보일 담당 — 업무 id → 고른 사람들 */
export type AssignOverrides = Record<string, Person[]>

/** 목록 한 줄 이름 — 3명을 넘으면 「외 n명」(lib/task-assignees.ts assigneeLabel 과 같은 규칙) */
function namesLabel(people: readonly Person[], max = 3): string {
  const names = people.map((p) => p.name)
  return names.length <= max ? names.join(", ") : `${names.slice(0, max).join(", ")} 외 ${names.length - max}명`
}

/**
 * 고른 사람들을 먼저 그린다. 서버 값이 이미 같으면 덮지 않는다.
 * 덮을 것이 없으면 받은 배열을 그대로 돌려준다(보드는 배열이 바뀌면 끌던 상태를 버린다).
 */
export function withAssignOverrides<T extends { id: string; unassigned?: boolean; ownerName: string | null; owners?: Person[] }>(
  tasks: T[],
  overrides: AssignOverrides,
): T[] {
  if (Object.keys(overrides).length === 0) return tasks
  let changed = false
  const next = tasks.map((t) => {
    const people = overrides[t.id]
    if (!people || people.length === 0) return t
    if (sameAssignees((t.owners ?? []).map((p) => p.id), people.map((p) => p.id))) return t
    changed = true
    return { ...t, unassigned: false, owners: people, ownerName: namesLabel(people) }
  })
  return changed ? next : tasks
}

/** 서버 값이 고른 사람들로 따라온(또는 사라진) 업무의 덮어쓰기를 걷는다. 걷을 것이 없으면 같은 객체 */
export function pruneAssignOverrides(overrides: AssignOverrides, tasks: { id: string; owners?: Person[] }[]): AssignOverrides {
  const ids = Object.keys(overrides)
  if (ids.length === 0) return overrides
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const keep = ids.filter((id) => {
    const t = byId.get(id)
    return !!t && !sameAssignees((t.owners ?? []).map((p) => p.id), overrides[id].map((p) => p.id))
  })
  if (keep.length === ids.length) return overrides
  return Object.fromEntries(keep.map((id) => [id, overrides[id]]))
}
