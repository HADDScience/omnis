// 보낸 글 고치기 · 지우기.
//
// 지울 때 행을 지우지 않는다(`deletedAt`) — 답장이 가리키는 글 · 업무 연결 · 색인이 함께 사라진다.
// 고치거나 지운 글이 업무에 붙어 있으면 응답 뒤에 재구성을 다시 돌린다(작업지시자 결정 2026-09-16):
// 지웠는데 그 내용이 업무 카드에 남아 있으면 지운 의미가 없다.
import { after, NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import { runTaskRebuild } from "@/lib/chat-post"
import { syncEmbeddingsSafe, deleteEmbeddingsSafe } from "@/lib/embeddings"
import { CHAT_DELETED_TEXT } from "@/lib/constants"

export const maxDuration = 60

interface Props {
  params: Promise<{ messageId: string }>
}

const TARGET = {
  id: true, authorId: true, roomId: true, taskId: true,
  kind: true, content: true, deletedAt: true, createdAt: true,
} as const

type Target = {
  id: string; authorId: string; roomId: string; taskId: string | null
  kind: string; content: string; deletedAt: Date | null; createdAt: Date
}

/** 손댈 수 있는 글인지. 막을 이유가 있으면 그 문장을 돌려준다. */
function refusal(message: Target, userId: string): string | null {
  if (message.authorId !== userId) return "내가 쓴 글만 고치거나 지울 수 있습니다"
  if (message.kind !== "NORMAL") return "옴니스가 남긴 글은 고치거나 지울 수 없습니다"
  if (message.content.startsWith("__TASK_CREATED__:")) return "업무 카드는 고치거나 지울 수 없습니다"
  if (message.content.startsWith("🤖")) return "옴니스가 남긴 글은 고치거나 지울 수 없습니다"
  if (message.deletedAt) return "이미 지운 글입니다"
  return null
}

/**
 * 업무에 붙은 글이 바뀌었으니 카드를 다시 만든다.
 *
 * 기준 시각은 글이 처음 쓰인 때가 아니라 **지금**이다. 원래 시각을 주면
 * 그 뒤에 온 글이 있다는 이유로 곧바로 `superseded` 가 되어 아무것도 반영되지 않는다.
 */
function rebuildAfterChange(
  message: Target,
  user: { id: string; name: string },
  restText: string
) {
  if (!message.taskId) return
  const taskId = message.taskId
  after(async () => {
    await runTaskRebuild({
      user,
      roomId: message.roomId,
      messageId: message.id,
      messageCreatedAt: new Date(),
      taskId,
      restText,
    })
  })
}

export async function PATCH(req: NextRequest, { params }: Props) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const { messageId } = await params
  const body = await req.json().catch(() => null)
  const content = typeof body?.content === "string" ? body.content.trim() : ""
  if (!content) return NextResponse.json({ error: "내용이 비어 있습니다" }, { status: 400 })

  const message = await prisma.chatMessage.findUnique({ where: { id: messageId }, select: TARGET })
  if (!message) return NextResponse.json({ error: "없는 메시지입니다" }, { status: 404 })

  const refused = refusal(message, session.user.id)
  if (refused) return NextResponse.json({ error: refused }, { status: 403 })

  const updated = await prisma.chatMessage.update({
    where: { id: messageId },
    data: { content, editedAt: new Date() },
    include: {
      author: { select: { id: true, name: true } },
      task: { select: { id: true, name: true, slug: true } },
      files: { select: { id: true, name: true, path: true, size: true, mimeType: true } },
      replyTo: { select: { id: true, content: true, deletedAt: true, author: { select: { name: true } } } },
    },
  })

  void syncEmbeddingsSafe("CHAT_MESSAGE", messageId, session.user.id)
  rebuildAfterChange(message, { id: session.user.id, name: session.user.name ?? "" }, content)

  return NextResponse.json({
    ...updated,
    replyTo: updated.replyTo
      ? {
          id: updated.replyTo.id,
          authorName: updated.replyTo.author.name,
          content: updated.replyTo.deletedAt ? CHAT_DELETED_TEXT : updated.replyTo.content.slice(0, 80),
        }
      : null,
    _rebuild: message.taskId ? "queued" : null,
  })
}

export async function DELETE(_req: NextRequest, { params }: Props) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const { messageId } = await params
  const message = await prisma.chatMessage.findUnique({ where: { id: messageId }, select: TARGET })
  if (!message) return NextResponse.json({ error: "없는 메시지입니다" }, { status: 404 })

  const refused = refusal(message, session.user.id)
  if (refused) return NextResponse.json({ error: refused }, { status: 403 })

  await prisma.chatMessage.update({
    where: { id: messageId },
    data: { deletedAt: new Date() },
  })

  // 색인에서도 뺀다 — 지운 글이 검색·RAG 에 남으면 지운 것이 아니다.
  void deleteEmbeddingsSafe("CHAT_MESSAGE", messageId)
  // 남은 글만으로 카드를 다시 만든다. 지운 글은 재구성 입력에서 빠진다(lib/chat-post.ts).
  rebuildAfterChange(message, { id: session.user.id, name: session.user.name ?? "" }, "(메시지 삭제)")

  return NextResponse.json({ id: messageId, deleted: true, _rebuild: message.taskId ? "queued" : null })
}
