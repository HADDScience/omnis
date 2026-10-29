"use client"

import { useDeferredValue, useMemo, type ReactNode } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon } from "@hugeicons/core-free-icons"
import { Badge } from "@/components/ui/badge"
import { TaskRowsView } from "@/components/tasks/task-rows-view"
import type { TaskCardData } from "@/components/tasks/task-card"
import { TasksViews } from "./tasks-views"
import type { KanbanTask } from "./tasks-board"
import type { WorkspaceViewProps } from "./overview/workspace-view"
import { TasksFilterMenu } from "./tasks-filter-menu"
import { FilterLink, useTasksFilter } from "./filter-link"
import { FILTER_LABEL } from "./filters"

/** 업무 한 건 + 필터가 보는 값. 「오늘 마감」 은 서버 시계로 미리 잰다 */
export interface FilterableTask {
  card: TaskCardData
  workspace: WorkspaceViewProps["tasks"][number]
  assigneeIds: string[]
  instructorId: string | null
  dueToday: boolean
  stalled: boolean
}

interface TasksBodyProps {
  tasks: FilterableTask[]
  members: { id: string; name: string }[]
  currentUserId: string
  products: WorkspaceViewProps["products"]
  projects: WorkspaceViewProps["projects"]
  toolbarEnd: ReactNode
}

/**
 * 업무 목록 · 보드 · 관계도 — 필터(?filter= · ?assignee=)를 브라우저에서 건다.
 * 서버는 업무 전체를 한 번 내려 주고, 칩을 누를 때마다 다시 묻지 않는다(filter-link.tsx).
 */
export function TasksBody({ tasks, members, currentUserId, products, projects, toolbarEnd }: TasksBodyProps) {
  // 칩의 켜짐 표시는 바로 바꾸고, 업무 682장을 다시 그리는 일은 뒤로 미룬다 — 필터를 풀 때 0.3초쯤 걸렸다
  const current = useTasksFilter()
  const filter = useDeferredValue(current.filter)
  const assigneeId = useDeferredValue(current.assignee)
  // 모르는 사람 ID 는 무시한다 — 빈 목록보다 전체 목록이 덜 헷갈린다
  const assignee = members.find((m) => m.id === assigneeId) ?? null

  // 보드는 받은 배열이 바뀌면 끌어 옮긴 상태를 버리고 새로 받는다 — 필터가 바뀔 때만 새 배열을 만든다
  const filtered = useMemo(
    () =>
      tasks.filter((t) => {
        if (assignee && !t.assigneeIds.includes(assignee.id)) return false
        switch (filter) {
          case "i-assigned":
            return !currentUserId || t.instructorId === currentUserId
          case "i-own":
            return !currentUserId || t.assigneeIds.includes(currentUserId)
          case "due-today":
            return t.dueToday
          case "stalled":
            return t.stalled
          default:
            return true
        }
      }),
    [tasks, filter, assignee, currentUserId]
  )
  const cards = useMemo(() => filtered.map((t) => t.card), [filtered])
  const boardTasks = useMemo<KanbanTask[]>(
    () =>
      cards.map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        status: t.status as KanbanTask["status"],
        ownerName: t.ownerName,
        projectName: t.projectName,
        productName: t.productName,
        productColor: t.productColor,
        deadline: t.deadline,
      })),
    [cards]
  )
  // 관계도도 목록과 같은 필터를 따른다 — 「멈춤」 을 걸고 관계도로 바꾸면 멈춘 것만 보인다
  const workspaceTasks = useMemo(() => filtered.map((t) => t.workspace), [filtered])

  const activeFilterLabel = [filter && FILTER_LABEL[filter], assignee && `${assignee.name} 담당`]
    .filter(Boolean)
    .join(" · ")

  return (
    <TasksViews
      boardTasks={boardTasks}
      listSlot={<TaskRowsView tasks={cards} />}
      workspace={{ products, projects, tasks: workspaceTasks }}
      toolbarStart={
        <>
          <span className="text-[12px] font-semibold">업무 · {filtered.length}</span>
          {activeFilterLabel ? (
            <FilterLink
              href="/tasks"
              className="inline-flex items-center gap-1 rounded-full border bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
              aria-label={`${activeFilterLabel} 필터 해제`}
            >
              {activeFilterLabel}
              <HugeiconsIcon icon={Cancel01Icon} size={10} aria-hidden />
            </FilterLink>
          ) : (
            <Badge variant="outline" className="hidden text-[10px] text-muted-foreground sm:inline-flex">
              전체
            </Badge>
          )}
          <TasksFilterMenu active={filter} />
        </>
      }
      toolbarEnd={toolbarEnd}
    />
  )
}
