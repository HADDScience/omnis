import { notFound } from "next/navigation"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { CHAT_DELETED_TEXT, TASK_STATUS_LABELS } from "@/lib/constants"
import { PUBLIC_MESSAGE_WHERE } from "@/lib/chat-rooms"
import { RoomHeader } from "@/components/messenger/room-header"
import { TaskThread } from "@/app/(main)/tasks/[taskId]/task-sidebar"

export const dynamic = "force-dynamic"

// 업무방 — 표가 없다. 업무에 묶인 글(taskId)을 방처럼 보여 준다. 스레드는 업무 상세 · 오른쪽 패널과 같은 TaskThread 다.
export default async function TaskRoomPage({ params }: { params: Promise<{ taskId: string }> }) {
  const session = await auth()
  if (!session?.user?.id) notFound()
  const { taskId } = await params

  const [task, rows] = await Promise.all([
    prisma.task.findUnique({ where: { id: taskId }, select: { id: true, name: true, slug: true, status: true } }),
    prisma.chatMessage.findMany({
      where: { taskId, ...PUBLIC_MESSAGE_WHERE },
      orderBy: { createdAt: "asc" },
      include: {
        author: { select: { id: true, name: true } },
        files: { select: { id: true, name: true, path: true, size: true, mimeType: true } },
        replyTo: { select: { id: true, content: true, deletedAt: true, author: { select: { name: true } } } },
      },
    }),
  ])
  if (!task) notFound()

  // 업무 상세(app/(main)/tasks/[taskId]/page.tsx)와 같은 규칙 — 지운 글은 자리만
  const messages = rows.map((m) => ({
    id: m.id,
    content: m.deletedAt ? CHAT_DELETED_TEXT : m.content,
    createdAt: m.createdAt.toISOString(),
    author: { id: m.author.id, name: m.author.name },
    isTaskInstruction: m.isTaskInstruction,
    kind: m.kind,
    files: m.deletedAt ? [] : m.files,
    editedAt: m.editedAt?.toISOString() ?? null,
    deletedAt: m.deletedAt?.toISOString() ?? null,
    replyTo: m.replyTo
      ? {
          id: m.replyTo.id,
          authorName: m.replyTo.author.name,
          content: m.replyTo.deletedAt ? CHAT_DELETED_TEXT : m.replyTo.content.slice(0, 80),
        }
      : null,
  }))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RoomHeader
        title={<><span className="mr-0.5 text-muted-foreground">#</span>{task.name}</>}
        subtitle={`업무방 · ${TASK_STATUS_LABELS[task.status] ?? task.status} · 글을 남기면 옴니스가 업무 카드를 갱신합니다`}
        link={{ href: `/tasks/${task.id}`, label: "업무 열기" }}
      />
      <div className="min-h-0 flex-1">
        <TaskThread key={task.id} taskId={task.id} taskName={task.name} messages={messages} currentUserId={session.user.id} />
      </div>
    </div>
  )
}
