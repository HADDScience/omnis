// 「담당 미배정」 — 미완료이면서 담당자가 0명인 업무.
//
// 알림도 담당자별 화면도 닿지 않아 묻힌다(2026-11-02). 화면 칩 · 목록 필터 · MCP list_tasks 가
// 같은 기준으로 세도록 여기 한 곳에 둔다. 보관(archived) 업무는 읽는 쪽이 이미 뺀다.

export const UNASSIGNED_LABEL = "담당 미배정"

/** 화면(메모리) 판정 */
export function isUnassignedOpen(task: { status: string; assigneeCount: number }): boolean {
  return task.status !== "DONE" && task.assigneeCount === 0
}

/** 마감 지난 것 → 임박 → 마감 없음. 마감 없는 업무끼리는 받은 순서를 지킨다 */
export function byDeadlineFirst(a: { deadline: string | null }, b: { deadline: string | null }): number {
  const da = a.deadline ? new Date(a.deadline).getTime() : Infinity
  const db = b.deadline ? new Date(b.deadline).getTime() : Infinity
  if (da === db) return 0
  return da - db
}

export interface ListTasksArgs {
  status?: string
  mine?: boolean
  assignee?: string
  project?: string
  query?: string
  overdue?: boolean
  unassigned?: boolean
}

/** MCP list_tasks 의 조건. unassigned 는 담당 조건 · 완료 상태와 함께 쓸 수 없다 — 답이 항상 0건이라 헷갈린다 */
export function listTasksWhere(args: ListTasksArgs, callerId: string): { where: Record<string, unknown> } | { error: string } {
  const where: Record<string, unknown> = { archived: false }
  if (args.status) where.status = args.status
  if (args.unassigned) {
    if (args.mine || args.assignee) return { error: "unassigned 는 mine · assignee 와 함께 쓸 수 없습니다." }
    if (args.status === "DONE") return { error: "unassigned 는 미완료 업무만 봅니다 — status=DONE 과 함께 쓸 수 없습니다." }
    where.assignees = { none: {} }
    if (!args.status) where.status = { not: "DONE" }
  } else if (args.mine) {
    where.assignees = { some: { userId: callerId } }
  } else if (args.assignee) {
    where.assignees = { some: { user: { name: { contains: args.assignee } } } }
  }
  if (args.project) where.project = { name: { contains: args.project, mode: "insensitive" } }
  if (args.query) {
    where.OR = [
      { name: { contains: args.query, mode: "insensitive" } },
      { background: { contains: args.query, mode: "insensitive" } },
    ]
  }
  if (args.overdue) {
    where.status = { not: "DONE" }
    where.deadline = { lt: new Date() }
  }
  return { where }
}
