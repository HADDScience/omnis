import Link from "next/link"
import { Header } from "@/components/layout/header"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import { DashboardPersonal } from "../dashboard/dashboard-personal"
import { TaskCreateButton } from "@/components/chat/task-create-button"
import { TasksViews } from "./tasks-views"
import type { KanbanTask } from "./tasks-board"
import { Badge } from "@/components/ui/badge"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon } from "@hugeicons/core-free-icons"
import type { Prisma } from "../../../generated/prisma/client"

export const dynamic = "force-dynamic"

const FILTER_LABEL: Record<string, string> = {
  "due-today": "오늘 마감",
  "i-assigned": "내가 지시한 업무",
  "i-own": "내가 담당",
}

interface Props {
  searchParams: Promise<{ filter?: string }>
}

export default async function TasksPage({ searchParams }: Props) {
  const session = await auth()
  const currentUserId = session?.user?.id ?? ""
  const sp = await searchParams
  const filter = sp.filter ?? null

  // 핫픽스: 기본 = 모든 업무 표시 (공유). 빠른 필터(?filter=...)로만 좁힘.
  const where: Prisma.TaskWhereInput = { archived: false }
  if (filter === "i-assigned" && currentUserId) {
    where.instructorId = currentUserId
  } else if (filter === "i-own" && currentUserId) {
    where.ownerId = currentUserId
  } else if (filter === "due-today") {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = new Date()
    end.setHours(23, 59, 59, 999)
    where.deadline = { gte: start, lte: end }
  }

  const tasks = await prisma.task.findMany({
    where,
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      priority: true,
      deadline: true,
      updatedAt: true,
      createdAt: true,
      ownerId: true,
      owner: { select: { name: true } },
      project: {
        select: {
          name: true,
          product: { select: { id: true, name: true, color: true } },
        },
      },
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
    ownerId: t.ownerId,
    ownerName: t.owner?.name ?? null,
  }))

  const boardTasks: KanbanTask[] = tasks.map((t) => ({
    id: t.id,
    slug: t.slug,
    name: t.name,
    status: t.status,
    ownerName: t.owner?.name ?? null,
    projectName: t.project?.name ?? null,
    productName: t.project?.product?.name ?? null,
    productColor: t.project?.product?.color ?? null,
    deadline: t.deadline?.toISOString() ?? null,
  }))

  const activeFilterLabel = filter ? FILTER_LABEL[filter] : null

  return (
    <>
      <Header title="업무" />
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b bg-background px-4 py-2">
          <span className="text-[12px] font-semibold">
            업무 · {tasks.length}
          </span>
          {activeFilterLabel && (
            <Link
              href="/tasks"
              className="inline-flex items-center gap-1 rounded-full border bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
              aria-label="필터 해제"
            >
              {activeFilterLabel}
              <HugeiconsIcon icon={Cancel01Icon} size={10} />
            </Link>
          )}
          {!activeFilterLabel && (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              전체
            </Badge>
          )}
          <div className="ml-auto">
            <TaskCreateButton />
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <TasksViews
            boardTasks={boardTasks}
            listSlot={
              <DashboardPersonal currentUserId={currentUserId} tasks={serialized} />
            }
          />
        </div>
      </div>
    </>
  )
}
