import { Header } from "@/components/layout/header"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import { DashboardPersonal } from "../dashboard/dashboard-personal"
import { TaskCreateButton } from "@/components/chat/task-create-button"
import { TasksViews } from "./tasks-views"
import type { KanbanTask } from "./tasks-board"

export const dynamic = "force-dynamic"

export default async function TasksPage() {
  const session = await auth()
  const currentUserId = session?.user?.id ?? ""

  const tasks = await prisma.task.findMany({
    where: { archived: false, ownerId: currentUserId },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      priority: true,
      deadline: true,
      updatedAt: true,
      createdAt: true,
      owner: { select: { name: true } },
      project: { select: { name: true } },
    },
    orderBy: { updatedAt: "desc" },
  })

  const serialized = tasks.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    status: t.status,
    priority: t.priority,
    deadline: t.deadline?.toISOString() ?? null,
    updatedAt: t.updatedAt.toISOString(),
    createdAt: t.createdAt.toISOString(),
    ownerId: currentUserId,
  }))

  const boardTasks: KanbanTask[] = tasks.map((t) => ({
    id: t.id,
    slug: t.slug,
    name: t.name,
    status: t.status,
    ownerName: t.owner?.name ?? null,
    projectName: t.project?.name ?? null,
    deadline: t.deadline?.toISOString() ?? null,
  }))

  return (
    <>
      <Header title="내 업무" />
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b bg-background px-4 py-2">
          <span className="text-[12px] font-semibold">내 업무 · {tasks.length}</span>
          <TaskCreateButton />
        </div>
        <div className="flex-1 overflow-hidden">
          <TasksViews
            boardTasks={boardTasks}
            listSlot={
              <DashboardPersonal
                currentUserId={currentUserId}
                tasks={serialized}
              />
            }
          />
        </div>
      </div>
    </>
  )
}
