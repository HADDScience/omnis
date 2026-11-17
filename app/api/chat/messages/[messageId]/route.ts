// 보낸 글 고치기 · 지우기.
//
// 지울 때 행을 지우지 않는다(`deletedAt`) — 답장이 가리키는 글 · 업무 연결 · 색인이 함께 사라진다.
// 고치거나 지운 글이 업무에 붙어 있으면 응답 뒤에 재구성을 다시 돌린다(작업지시자 결정 2026-09-16):
// 지웠는데 그 내용이 업무 카드에 남아 있으면 지운 의미가 없다.
import { attachAwareText } from "@/lib/attachment-text"
import { after, NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import { extractMentionSlug, runTaskRebuild } from "@/lib/chat-post"
import { replaceMentions } from "@/lib/mentions"
import { syncEmbeddingsSafe, deleteEmbeddingsSafe } from "@/lib/embeddings"
import { CHAT_DELETED_TEXT } from "@/lib/constants"
import { roomAccess } from "@/lib/chat-rooms"
import { messageChangeRefusal } from "@/lib/message-edit"

export const maxDuration = 60

interface Props {
  params: Promise<{ messageId: string }>
}

const TARGET = {
  id: true, authorId: true, roomId: true, taskId: true,
  kind: true, content: true, deletedAt: true, createdAt: true, sourceId: true,
} as const

type Target = {
  id: string; authorId: string; roomId: string; taskId: string | null
  kind: string; content: string; deletedAt: Date | null; createdAt: Date; sourceId: string | null
}

/** 사람끼리 방(1:1 · 단톡)의 글인가 */
async function peopleRoomOf(roomId: string): Promise<boolean> {
  const room = await prisma.chatRoom.findUnique({ where: { id: roomId }, select: { kind: true } })
  return room?.kind === "DM" || room?.kind === "GROUP"
}

async function roomAccessOk(roomId: string, userId: string): Promise<boolean> {
  return (await roomAccess(roomId, userId)) === "ok"
}

/** 고치기 전 본문 한 줄(관리자 감사). 본문 바꾸기와 한 트랜잭션에 넣는다 — 둘이 함께 되거나 함께 안 된다 */
const revisionOf = (message: Target, userId: string) =>
  prisma.chatMessageRevision.create({ data: { messageId: message.id, content: message.content, editedById: userId } })

/**
 * 업무에 붙은 글이 바뀌었으니 카드를 다시 만든다.
 *
 * 기준 시각은 글이 처음 쓰인 때가 아니라 **지금**이다. 원래 시각을 주면
 * 그 뒤에 온 글이 있다는 이유로 곧바로 `superseded` 가 되어 아무것도 반영되지 않는다.
 */
function rebuildAfterChange(
  message: Target,
  user: { id: string; name: string },
  restText: string,
  taskId: string | null = message.taskId
) {
  if (!taskId) return
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

/**
 * 고친 글의 `#슬러그` 로 업무 연결을 다시 잡는다 (2026-09-16).
 *
 * 전체 채팅에 그냥 쓴 글을 뒤늦게 업무에 붙이려면 이 길이 있어야 한다 — 그 전에는
 * 고쳐서 `#슬러그` 를 넣어도 화면에만 칩으로 보이고 스레드에는 오지 않았다.
 *
 * 다른 업무로 **옮기는 것도 허용한다**(작업지시자 결정). 옮기면 옛 업무는 그 글이 빠진
 * 채로, 새 업무는 그 글이 붙은 채로 각각 다시 구성해야 근거가 맞는다.
 */
async function resolveTask(content: string, current: string | null): Promise<{ taskId: string | null; restText: string }> {
  const mention = extractMentionSlug(content)
  if (!mention) return { taskId: current, restText: content }

  const task = await prisma.task.findUnique({ where: { slug: mention.slug }, select: { id: true } })
  if (!task) return { taskId: current, restText: content }
  return { taskId: task.id, restText: mention.restText || content }
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

  const refused = messageChangeRefusal(message, session.user.id, "edit")
  if (refused) return NextResponse.json({ error: refused }, { status: 403 })
  // 같은 본문이면 고친 것이 아니다 — 「수정됨」 · 이력 · 재구성을 남기지 않는다
  if (content === message.content) return NextResponse.json({ error: "바뀐 내용이 없습니다" }, { status: 400 })

  // 사람끼리 방(1:1 · 단톡) — 지금 참여자일 때만 고친다. 업무 연결 · 재구성 · 색인 · 멘션 표를 건드리지 않는다(방 밖으로 새는 길)
  const people = await peopleRoomOf(message.roomId)
  if (people) {
    if (!(await roomAccessOk(message.roomId, session.user.id))) return NextResponse.json({ error: "방을 찾을 수 없습니다" }, { status: 404 })
    const [, edited] = await prisma.$transaction([revisionOf(message, session.user.id), prisma.chatMessage.update({
      where: { id: messageId },
      // changedAt — 남의 화면 폴링이 이 글을 다시 받아 간다
      data: { content, editedAt: new Date(), changedAt: new Date() },
      include: {
        author: { select: { id: true, name: true } },
        task: { select: { id: true, name: true, slug: true } },
        files: { select: { id: true, name: true, path: true, size: true, mimeType: true } },
        replyTo: { select: { id: true, content: true, deletedAt: true, _count: { select: { files: true } }, author: { select: { name: true } } } },
      },
    })])
    return NextResponse.json({
      ...edited,
      replyTo: edited.replyTo
        ? {
            id: edited.replyTo.id,
            authorName: edited.replyTo.author.name,
            content: edited.replyTo.deletedAt ? CHAT_DELETED_TEXT : attachAwareText(edited.replyTo.content, edited.replyTo._count.files).slice(0, 80),
            deleted: !!edited.replyTo.deletedAt,
          }
        : null,
      _rebuild: null,
    })
  }

  const { taskId: nextTaskId, restText } = await resolveTask(content, message.taskId)
  const movedFrom = message.taskId && nextTaskId !== message.taskId ? message.taskId : null

  const [, updated] = await prisma.$transaction([revisionOf(message, session.user.id), prisma.chatMessage.update({
    where: { id: messageId },
    data: { content, editedAt: new Date(), changedAt: new Date(), taskId: nextTaskId },
    include: {
      author: { select: { id: true, name: true } },
      task: { select: { id: true, name: true, slug: true } },
      files: { select: { id: true, name: true, path: true, size: true, mimeType: true } },
      replyTo: { select: { id: true, content: true, deletedAt: true, _count: { select: { files: true } }, author: { select: { name: true } } } },
    },
  })])

  // 멘션은 더하지 않고 갈아끼운다 — 옛 멘션이 남으면 스레드 라우팅이 옛 업무를 가리킨다
  void replaceMentions(messageId, content).catch(() => {})
  void syncEmbeddingsSafe("CHAT_MESSAGE", messageId, session.user.id)

  const user = { id: session.user.id, name: session.user.name ?? "" }
  rebuildAfterChange(message, user, restText, nextTaskId)
  // 떠난 업무도 다시 구성한다 — 그 글이 빠진 채로 카드가 맞아야 한다
  if (movedFrom) rebuildAfterChange(message, user, "(다른 업무로 옮긴 글)", movedFrom)

  return NextResponse.json({
    ...updated,
    replyTo: updated.replyTo
      ? {
          id: updated.replyTo.id,
          authorName: updated.replyTo.author.name,
          content: updated.replyTo.deletedAt ? CHAT_DELETED_TEXT : attachAwareText(updated.replyTo.content, updated.replyTo._count.files).slice(0, 80),
          deleted: !!updated.replyTo.deletedAt,
        }
      : null,
    _rebuild: nextTaskId || movedFrom ? "queued" : null,
    _taskId: nextTaskId,
    _movedFrom: movedFrom,
  })
}

export async function DELETE(_req: NextRequest, { params }: Props) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const { messageId } = await params
  const message = await prisma.chatMessage.findUnique({ where: { id: messageId }, select: TARGET })
  if (!message) return NextResponse.json({ error: "없는 메시지입니다" }, { status: 404 })

  const refused = messageChangeRefusal(message, session.user.id, "delete")
  if (refused) return NextResponse.json({ error: refused }, { status: 403 })
  if ((await peopleRoomOf(message.roomId)) && !(await roomAccessOk(message.roomId, session.user.id))) {
    return NextResponse.json({ error: "방을 찾을 수 없습니다" }, { status: 404 })
  }

  await prisma.chatMessage.update({
    where: { id: messageId },
    // changedAt — 남의 화면에서도 본문이 걷히게. 없으면 지운 글이 새로고침 전까지 보인다
    data: { deletedAt: new Date(), changedAt: new Date() },
  })

  // 색인에서도 뺀다 — 지운 글이 검색·RAG 에 남으면 지운 것이 아니다.
  void deleteEmbeddingsSafe("CHAT_MESSAGE", messageId)
  // 그 메시지의 사진 설명도 — 사진을 지웠는데 설명으로 찾아지면 지운 것이 아니다
  for (const f of await prisma.file.findMany({ where: { messageId }, select: { id: true } })) void deleteEmbeddingsSafe("PHOTO", f.id)
  // 남은 글만으로 카드를 다시 만든다. 지운 글은 재구성 입력에서 빠진다(lib/chat-post.ts).
  rebuildAfterChange(message, { id: session.user.id, name: session.user.name ?? "" }, "(메시지 삭제)")

  return NextResponse.json({ id: messageId, deleted: true, _rebuild: message.taskId ? "queued" : null })
}
