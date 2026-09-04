import { prisma } from "@/lib/db"
import { notFound } from "next/navigation"
import { Header } from "@/components/layout/header"
import { TaskDetail } from "./task-detail"
import { RegisterPanelTask } from "@/components/layout/right-panel-context"

export const dynamic = "force-dynamic"

interface Props {
  params: Promise<{ taskId: string }>
}

export default async function TaskDetailPage({ params }: Props) {
  const { taskId } = await params

  const [task, feedbackMessages, files, projects] = await Promise.all([
    prisma.task.findUnique({
      where: { id: taskId },
      include: {
        assignees: { select: { user: { select: { id: true, name: true } } } },
        instructor: { select: { id: true, name: true } },
        checklists: { orderBy: [{ done: "asc" }, { createdAt: "asc" }] },
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
      select: {
        id: true,
        name: true,
        product: { select: { id: true, name: true, color: true } },
      },
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
    // 조인 테이블 모양을 화면이 쓰기 좋은 {id, name}[] 으로 편다
    assignees: task.assignees.map((a) => a.user),
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
      {/* 스레드는 오른쪽 패널이 맡는다. 여기서 자리를 차지하지 않는다 —
          예전에는 320px 을 고정으로 먹어 좁은 화면에서 본문이 34px 로 눌렸다. */}
      <RegisterPanelTask id={task.id} name={task.name} messages={sidebarMessages} />
      <div className="flex flex-1 overflow-hidden">
        <div className="min-w-0 flex-1 overflow-auto">
          <TaskDetail task={serialized} projects={projects} />
        </div>
      </div>
    </>
  )
}
