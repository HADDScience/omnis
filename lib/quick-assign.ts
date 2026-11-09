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
