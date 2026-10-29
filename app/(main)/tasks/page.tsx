import Link from "next/link"
import { assigneeLabel } from "@/lib/task-assignees"
import { Header } from "@/components/layout/header"
import { auth } from "@/lib/auth"
import { TaskCreateButton } from "@/components/chat/task-create-button"
import { loadTasksOverview } from "./overview/load-overview"
import { TasksStatusBand } from "./overview/tasks-status-band"
import { DashboardGeminiBadge } from "./overview/dashboard-gemini-usage"
import { TasksBody, type FilterableTask } from "./tasks-body"

export const dynamic = "force-dynamic"

/**
 * 업무 전체를 한 번 내려 준다. 빠른 필터(?filter=)·담당자(?assignee=)는 브라우저가 건다 —
 * 칩을 누를 때마다 이 함수가 다시 돌면 화면이 멈췄다가 한꺼번에 바뀌었다(tasks-body.tsx).
 */
export default async function TasksPage() {
  const session = await auth()
  const currentUserId = session?.user?.id ?? ""

  const overview = await loadTasksOverview()
  const { now, allTasks, stalledIds } = overview

  const dayStart = new Date(now)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(now)
  dayEnd.setHours(23, 59, 59, 999)

  const tasks: FilterableTask[] = allTasks.map((t) => ({
    card: {
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
    },
    workspace: {
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
    },
    assigneeIds: t.assignees.map((a) => a.user.id),
    instructorId: t.instructorId,
    dueToday: !!t.deadline && t.deadline >= dayStart && t.deadline <= dayEnd,
    stalled: stalledIds.has(t.id),
  }))

  return (
    // 바깥 스크롤러(main-with-chat)는 block 이라 flex-1 이 먹지 않아, 보드가 완료 600여 장 길이로 늘어났다.
    // 드래그하면 그 긴 페이지 전체가 자동 스크롤돼 화면이 튀었다 — 화면 높이에 묶고 컬럼 안에서 스크롤한다
    <div className="flex h-full flex-col">
      {/* 300px 아래에서는 AI 사용량을 접는다 — 남겨 두면 맨 끝 「마이」 동그라미가 화면 밖으로 밀려났다(200px 실측) */}
      <Header
        title="업무"
        actions={
          <span className="contents max-[300px]:hidden">
            <DashboardGeminiBadge data={overview.geminiUsage} />
          </span>
        }
      />
      <TasksStatusBand
        tasksForProgress={allTasks.map((t) => ({
          status: t.status,
          updatedAt: t.updatedAt.toISOString(),
        }))}
        stalledCount={stalledIds.size}
        members={overview.userStats.map((u) => ({ id: u.id, name: u.name, inProgress: u.inProgress }))}
        stalledGroups={overview.stalledGroups}
        userStats={overview.userStats}
        gajumMarkdown={overview.gajumMarkdown}
        gwajaeMarkdown={overview.gwajaeMarkdown}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TasksBody
          tasks={tasks}
          members={overview.users.map((u) => ({ id: u.id, name: u.name }))}
          currentUserId={currentUserId}
          products={overview.workspaceProducts}
          projects={overview.workspaceProjects}
          toolbarEnd={
            <>
              <Link
                href="/tasks/projects"
                className="hidden h-8 shrink-0 items-center rounded-md px-2.5 text-[11.5px] font-medium transition-colors hover:bg-muted hover:text-foreground sm:inline-flex"
              >
                프로젝트 정리
              </Link>
              {/* 폰은 + 만 — 「프로젝트 정리」 는 필터 메뉴 안에 있다 */}
              <TaskCreateButton
                className="touch-hit max-sm:size-8 max-sm:px-0"
                labelClassName="sr-only sm:not-sr-only"
              />
            </>
          }
        />
      </div>
    </div>
  )
}
