// 채팅 피드 읽기 — 화면(app/api/chat/feed)과 MCP(list_chat)가 같은 길을 쓴다.
// 라우트에서 그대로 옮겼다(2026-09-16). 보기(view)마다 무엇을 모으는지가 여기 한 곳에 있다.
import { prisma } from "@/lib/db"

export type FeedView = "all" | "task" | "dm" | "ai"

const INCLUDE = {
  author: { select: { id: true, name: true } },
  task: { select: { id: true, name: true, slug: true } },
  files: { select: { id: true, name: true, path: true, size: true, mimeType: true } },
  mentions: true,
} as const

export type FeedMessage = Awaited<ReturnType<typeof prisma.chatMessage.findMany<{ include: typeof INCLUDE }>>>[number]

/**
 * 오래된 것 → 새 것 순으로 돌려준다(화면이 그 순서로 그린다).
 * `dm` 은 서로를 @멘션한 글, `ai` 는 Omnis AI 가 쓰거나 불린 글이다.
 */
export async function readChatFeed(input: {
  currentUserId: string
  view: FeedView
  /** view=task 일 때 업무 id */
  id?: string
  /** view=dm 일 때 상대 사용자 id */
  userId?: string
  take?: number
}): Promise<{ error: string } | { messages: FeedMessage[] }> {
  const take = Math.min(input.take ?? 100, 200)
  const { view, id, userId, currentUserId } = input
  let messages: FeedMessage[] = []

  if (view === "all") {
    messages = await prisma.chatMessage.findMany({ orderBy: { createdAt: "desc" }, take, include: INCLUDE })
  } else if (view === "task" && id) {
    const mentioned = await prisma.chatMention.findMany({ where: { type: "TASK", taskId: id }, select: { messageId: true } })
    messages = await prisma.chatMessage.findMany({
      where: { OR: [{ id: { in: mentioned.map((m) => m.messageId) } }, { taskId: id }] },
      orderBy: { createdAt: "desc" }, take, include: INCLUDE,
    })
  } else if (view === "dm" && userId) {
    const mentioned = await prisma.chatMention.findMany({
      where: {
        type: "USER",
        OR: [
          { userId, message: { authorId: currentUserId } },
          { userId: currentUserId, message: { authorId: userId } },
        ],
      },
      select: { messageId: true },
    })
    messages = await prisma.chatMessage.findMany({
      where: { id: { in: mentioned.map((m) => m.messageId) } },
      orderBy: { createdAt: "desc" }, take, include: INCLUDE,
    })
  } else if (view === "ai") {
    const aiUser = await prisma.user.findFirst({ where: { name: "Omnis AI" }, select: { id: true } })
    messages = aiUser
      ? await prisma.chatMessage.findMany({
          where: {
            OR: [{ authorId: aiUser.id }, { mentions: { some: { type: "USER", userId: aiUser.id } } }],
          },
          orderBy: { createdAt: "desc" }, take, include: INCLUDE,
        })
      : []
  } else {
    return { error: "invalid view" }
  }

  return { messages: messages.reverse() }
}
