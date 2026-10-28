import Link from "next/link"
import { assigneeLabel } from "@/lib/task-assignees"
import { Header } from "@/components/layout/header"
import { auth } from "@/lib/auth"
import { TaskCreateButton } from "@/components/chat/task-create-button"
import { TasksViews } from "./tasks-views"
import type { KanbanTask } from "./tasks-board"
import { TaskRowsView } from "@/components/tasks/task-rows-view"
import type { TaskCardData } from "@/components/tasks/task-card"
import { Badge } from "@/components/ui/badge"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon } from "@hugeicons/core-free-icons"
import { loadTasksOverview } from "./overview/load-overview"
import { TasksStatusBand } from "./overview/tasks-status-band"
import { DashboardGeminiBadge } from "./overview/dashboard-gemini-usage"

export const dynamic = "force-dynamic"

const FILTER_LABEL: Record<string, string> = {
  "due-today": "오늘 마감",
  "i-assigned": "내가 지시한 업무",
  "i-own": "내가 담당",
  stalled: "멈춰 있는 업무",
}

interface Props {
  searchParams: Promise<{ filter?: string; assignee?: string }>
}

export default async function TasksPage({ searchParams }: Props) {
  const session = await auth()
  const currentUserId = session?.user?.id ?? ""
  const sp = await searchParams
  const filter = sp.filter && FILTER_LABEL[sp.filter] ? sp.filter : null

  const overview = await loadTasksOverview()
  const { now, allTasks, stalledIds } = overview
  // 모르는 사람 ID 는 무시한다 — 빈 목록보다 전체 목록이 덜 헷갈린다
  const assignee = overview.users.find((u) => u.id === sp.assignee) ?? null

  // 핫픽스: 기본 = 모든 업무 표시 (공유). 빠른 필터(?filter=...)·담당자(?assignee=...)로만 좁힘.
  const dayStart = new Date(now)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(now)
  dayEnd.setHours(23, 59, 59, 999)
  const tasks = allTasks.filter((t) => {
    if (assignee && !t.assignees.some((a) => a.user.id === assignee.id)) return false
    switch (filter) {
      case "i-assigned":
        return !currentUserId || t.instructorId === currentUserId
      case "i-own":
        // 내가 담당자 중 한 명인 업무
        return !currentUserId || t.assignees.some((a) => a.user.id === currentUserId)
      case "due-today":
        return !!t.deadline && t.deadline >= dayStart && t.deadline <= dayEnd
      case "stalled":
        return stalledIds.has(t.id)
      default:
        return true
    }
  })

  const cardData: TaskCardData[] = tasks.map((t) => ({
    id: t.id,
    slug: t.slug,
    name: t.name,
    status: t.status,
    priority: t.priority,
    ownerName: t.assignees.length > 0 ? assigneeLabel(t.assignees) : null,
    projectName: t.project?.name ?? null,
    productName: t.project?.product?.name ?? null,
    productColor: t.project?.product?.color ?? null,
    deadline: t.deadline?.toISOString() ?? null,
  }))

  const boardTasks: KanbanTask[] = cardData.map((t) => ({
    id: t.id,
    slug: t.slug,
    name: t.name,
    status: t.status as KanbanTask["status"],
    ownerName: t.ownerName,
    projectName: t.projectName,
    productName: t.productName,
    productColor: t.productColor,
    deadline: t.deadline,
  }))

  // 관계도도 목록과 같은 필터를 따른다 — 「멈춤」 을 걸고 관계도로 바꾸면 멈춘 것만 보인다
  const workspaceTasks = tasks.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    status: t.status,
    priority: t.priority,
    categoryId: null,
    categoryName: null,
    productId: t.productId ?? t.project?.product?.id ?? null,
    projectId: t.project?.id ?? null,
    projectName: t.project?.name ?? null,
    ownerIds: t.assignees.map((a) => a.user.id),
    ownerName: assigneeLabel(t.assignees),
    deadline: t.deadline ? t.deadline.toISOString() : null,
    isOverdue: !!(t.deadline && t.deadline < now && t.status !== "DONE"),
    checklistDone: t.checklists.filter((c) => c.done).length,
    checklistTotal: t.checklists.length,
  }))

  const activeFilterLabel = [filter && FILTER_LABEL[filter], assignee && `${assignee.name} 담당`]
    .filter(Boolean)
    .join(" · ")

  return (
    // 바깥 스크롤러(main-with-chat)는 block 이라 flex-1 이 먹지 않아, 보드가 완료 600여 장 길이로 늘어났다.
    // 드래그하면 그 긴 페이지 전체가 자동 스크롤돼 화면이 튀었다 — 화면 높이에 묶고 컬럼 안에서 스크롤한다
    <div className="flex h-full flex-col">
      <Header title="업무" actions={<DashboardGeminiBadge data={overview.geminiUsage} />} />
      <TasksStatusBand
        tasksForProgress={allTasks.map((t) => ({
          status: t.status,
          updatedAt: t.updatedAt.toISOString(),
        }))}
        stalledCount={stalledIds.size}
        members={overview.userStats.map((u) => ({ id: u.id, name: u.name, inProgress: u.inProgress }))}
        activeFilter={filter}
        activeAssignee={assignee?.id ?? null}
        stalledGroups={overview.stalledGroups}
        userStats={overview.userStats}
        gajumMarkdown={overview.gajumMarkdown}
        gwajaeMarkdown={overview.gwajaeMarkdown}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TasksViews
          boardTasks={boardTasks}
          listSlot={<TaskRowsView tasks={cardData} />}
          workspace={{
            products: overview.workspaceProducts,
            projects: overview.workspaceProjects,
            tasks: workspaceTasks,
          }}
          toolbarStart={
            <>
              <span className="text-[12px] font-semibold">업무 · {tasks.length}</span>
              {activeFilterLabel ? (
                <Link
                  href="/tasks"
                  className="inline-flex items-center gap-1 rounded-full border bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
                  aria-label={`${activeFilterLabel} 필터 해제`}
                >
                  {activeFilterLabel}
                  <HugeiconsIcon icon={Cancel01Icon} size={10} aria-hidden />
                </Link>
              ) : (
                <Badge variant="outline" className="text-[10px] text-muted-foreground">
                  전체
                </Badge>
              )}
            </>
          }
          toolbarEnd={
            <>
              <Link
                href="/tasks/projects"
                className="inline-flex h-8 shrink-0 items-center rounded-md px-2.5 text-[11.5px] font-medium transition-colors hover:bg-muted hover:text-foreground"
              >
                프로젝트 정리
              </Link>
              <TaskCreateButton />
            </>
          }
        />
      </div>
    </div>
  )
}
