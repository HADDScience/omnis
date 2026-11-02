/**
 * 담당 미배정 기준 · list_tasks 조건 · 정렬. 실행: pnpm test:unit
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { byDeadlineFirst, isUnassignedOpen, listTasksWhere } from "./task-unassigned"
import { OMNIS_TOOLS } from "./omnis-mcp"

test("미완료이면서 담당 0명만 담당 미배정이다", () => {
  for (const status of ["TODO", "IN_PROGRESS", "REVIEW"]) {
    assert.equal(isUnassignedOpen({ status, assigneeCount: 0 }), true, status)
    assert.equal(isUnassignedOpen({ status, assigneeCount: 1 }), false, status)
  }
  assert.equal(isUnassignedOpen({ status: "DONE", assigneeCount: 0 }), false)
})

test("마감 지난 것 → 임박 → 마감 없음 순으로 줄 세운다", () => {
  const rows = [
    { id: "없음", deadline: null },
    { id: "다음주", deadline: "2026-11-09T00:00:00.000Z" },
    { id: "지남", deadline: "2026-10-30T00:00:00.000Z" },
    { id: "오늘", deadline: "2026-11-02T00:00:00.000Z" },
  ]
  assert.deepEqual([...rows].sort(byDeadlineFirst).map((r) => r.id), ["지남", "오늘", "다음주", "없음"])
})

test("unassigned=true 는 담당 0명 · 미완료 · 보관 제외로 찾는다", () => {
  const r = listTasksWhere({ unassigned: true }, "me")
  assert.ok("where" in r)
  assert.deepEqual(r.where, { archived: false, assignees: { none: {} }, status: { not: "DONE" } })
})

test("unassigned 에 미완료 상태를 주면 그 상태로 좁힌다", () => {
  const r = listTasksWhere({ unassigned: true, status: "IN_PROGRESS" }, "me")
  assert.ok("where" in r)
  assert.equal(r.where.status, "IN_PROGRESS")
})

test("unassigned 와 담당 조건 · 완료 상태는 함께 쓸 수 없다 (거부되어야 하는 경우)", () => {
  assert.ok("error" in listTasksWhere({ unassigned: true, mine: true }, "me"))
  assert.ok("error" in listTasksWhere({ unassigned: true, assignee: "정우창" }, "me"))
  assert.ok("error" in listTasksWhere({ unassigned: true, status: "DONE" }, "me"))
})

test("unassigned 를 주지 않으면 지금까지의 조건 그대로다", () => {
  const mine = listTasksWhere({ mine: true }, "me")
  assert.ok("where" in mine)
  assert.deepEqual(mine.where, { archived: false, assignees: { some: { userId: "me" } } })
  const other = listTasksWhere({ assignee: "정우창", status: "TODO" }, "me")
  assert.ok("where" in other)
  assert.deepEqual(other.where, { archived: false, status: "TODO", assignees: { some: { user: { name: { contains: "정우창" } } } } })
})

test("unassigned 와 overdue 를 함께 주면 마감 지난 미배정만 찾는다", () => {
  const r = listTasksWhere({ unassigned: true, overdue: true }, "me")
  assert.ok("where" in r)
  assert.deepEqual(r.where.assignees, { none: {} })
  assert.deepEqual(r.where.status, { not: "DONE" })
  assert.ok((r.where.deadline as { lt: Date }).lt instanceof Date)
})

test("MCP list_tasks 스키마에 unassigned 가 열려 있다", () => {
  const tool = OMNIS_TOOLS.find((t) => t.name === "list_tasks")
  assert.ok(tool)
  const props = tool.inputSchema.properties as Record<string, { type?: string }>
  assert.equal(props.unassigned?.type, "boolean")
})
