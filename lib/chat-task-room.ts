// 업무방 하나의 글 — 메신저 업무방(/chat/task/[taskId])과 오른쪽 패널의 업무방이 함께 읽는다.
// 업무방은 표가 없다. 업무에 묶인 글(taskId)을 방처럼 보여 준다. 업무 · 업무 카드는 전사 공개라 로그인한 구성원이면 읽는다
import { attachAwareText } from "@/lib/attachment-text"
import { prisma } from "@/lib/db"
import { CHAT_DELETED_TEXT } from "@/lib/constants"
import { PUBLIC_MESSAGE_WHERE } from "@/lib/chat-rooms"
import { roomMuted } from "@/lib/chat-prefs"

export async function loadTaskRoom(taskId: string, userId: string) {
  const [task, rows, muted] = await Promise.all([
    prisma.task.findUnique({ where: { id: taskId }, select: { id: true, name: true, slug: true, status: true } }),
    prisma.chatMessage.findMany({
      where: { taskId, ...PUBLIC_MESSAGE_WHERE },
      orderBy: { createdAt: "asc" },
      include: {
        author: { select: { id: true, name: true } },
        files: { select: { id: true, name: true, path: true, size: true, mimeType: true } },
        replyTo: { select: { id: true, content: true, deletedAt: true, _count: { select: { files: true } }, author: { select: { name: true } } } },
      },
    }),
    roomMuted(userId, `task:${taskId}`),
  ])
  if (!task) return null

  // 업무 상세(app/(main)/tasks/[taskId]/page.tsx)와 같은 규칙 — 지운 글은 자리만
  const messages = rows.map((m) => ({
    id: m.id,
    sourceId: m.sourceId,
    content: m.deletedAt ? CHAT_DELETED_TEXT : m.content,
    createdAt: m.createdAt.toISOString(),
    author: { id: m.author.id, name: m.author.name },
    isTaskInstruction: m.isTaskInstruction,
    kind: m.kind,
    files: m.deletedAt ? [] : m.files,
    editedAt: m.editedAt?.toISOString() ?? null,
    changedAt: m.changedAt?.toISOString() ?? null,
    deletedAt: m.deletedAt?.toISOString() ?? null,
    replyTo: m.replyTo
      ? {
          id: m.replyTo.id,
          authorName: m.replyTo.author.name,
          content: m.replyTo.deletedAt ? CHAT_DELETED_TEXT : attachAwareText(m.replyTo.content, m.replyTo._count.files).slice(0, 80),
          deleted: !!m.replyTo.deletedAt,
        }
      : null,
  }))
  return { task, messages, muted }
}

export type TaskRoomData = NonNullable<Awaited<ReturnType<typeof loadTaskRoom>>>
