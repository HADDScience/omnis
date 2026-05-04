import { prisma } from "@/lib/db"
import { notFound } from "next/navigation"
import { Header } from "@/components/layout/header"
import { TaskDetail } from "./task-detail"
import { TaskSidebar } from "./task-sidebar"

export const dynamic = "force-dynamic"

interface Props {
  params: Promise<{ taskId: string }>
}

export default async function TaskDetailPage({ params }: Props) {
  const { taskId } = await params

  const [task, feedbackMessages, files, projects, categories] = await Promise.all([
    prisma.task.findUnique({
      where: { id: taskId },
      include: {
        owner: { select: { id: true, name: true } },
        instructor: { select: { id: true, name: true } },
        checklists: { orderBy: { createdAt: "asc" } },
        category: { select: { id: true, name: true, icon: true } },
        project: {
          select: {
            id: true,
            name: true,
            product: { select: { id: true, name: true, color: true } },
          },
        },
      },
    }),
    prisma.chatMessage.findMany({
      where: { taskId },
      orderBy: { createdAt: "asc" },
      include: { author: { select: { id: true, name: true } } },
    }),
    prisma.file.findMany({
      where: { taskId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, path: true, size: true, mimeType: true, createdAt: true },
    }),
    prisma.project.findMany({
      where: { archived: false },
      select: { id: true, name: true },
    }),
    prisma.taskCategory.findMany({
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, icon: true },
    }),
  ])

  if (!task) notFound()

  const serialized = {
    ...task,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    deadline: task.deadline?.toISOString() ?? null,
    workStart: task.workStart?.toISOString() ?? null,
    workEnd: task.workEnd?.toISOString() ?? null,
    checklists: task.checklists.map((c) => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
    })),
    feedbackMessages: feedbackMessages.map((m) => ({
      id: m.id,
      content: m.content,
      author: m.author,
      isTaskInstruction: m.isTaskInstruction,
      createdAt: m.createdAt.toISOString(),
    })),
    files: files.map((f) => ({
      ...f,
      createdAt: f.createdAt.toISOString(),
    })),
  }

  const sidebarMessages = feedbackMessages.map((m) => ({
    id: m.id,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
    author: { id: m.author.id, name: m.author.name },
    isTaskInstruction: m.isTaskInstruction,
    kind: m.kind,
  }))

  return (
    <>
      <Header title={task.name} />
      <div className="flex flex-1 overflow-hidden">
        <div className="min-w-0 flex-1 overflow-auto">
          <TaskDetail task={serialized} projects={projects} categories={categories} />
        </div>
        <TaskSidebar
          taskId={task.id}
          taskName={task.name}
          messages={sidebarMessages}
          checklists={task.checklists.map((c) => ({
            id: c.id,
            name: c.name,
            done: c.done,
          }))}
        />
      </div>
    </>
  )
}
