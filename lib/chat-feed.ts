// 채팅 피드 읽기 — 화면(app/api/chat/feed)과 MCP(list_chat)가 같은 길을 쓴다.
// 라우트에서 그대로 옮겼다(2026-09-16). 보기(view)마다 무엇을 모으는지가 여기 한 곳에 있다.
import { prisma } from "@/lib/db"
import { listRooms, PUBLIC_MESSAGE_WHERE, roomAccess } from "@/lib/chat-rooms"
import { peopleRoomTitle } from "@/lib/chat-people-rules"
import { displayAuthor, EXTERNAL_SPEAKER_SELECT } from "@/lib/external-speaker"
import type { PickableRoom } from "@/lib/chat-room-pick"

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
 * 어느 보기든 전사방 글만 — 옴니스 1:1 · 단톡 글은 그 방 참여자만 읽는다(lib/chat-rooms.ts).
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
    messages = await prisma.chatMessage.findMany({ where: PUBLIC_MESSAGE_WHERE, orderBy: { createdAt: "desc" }, take, include: INCLUDE })
  } else if (view === "task" && id) {
    const mentioned = await prisma.chatMention.findMany({ where: { type: "TASK", taskId: id }, select: { messageId: true } })
    messages = await prisma.chatMessage.findMany({
      where: { ...PUBLIC_MESSAGE_WHERE, OR: [{ id: { in: mentioned.map((m) => m.messageId) } }, { taskId: id }] },
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
      where: { ...PUBLIC_MESSAGE_WHERE, id: { in: mentioned.map((m) => m.messageId) } },
      orderBy: { createdAt: "desc" }, take, include: INCLUDE,
    })
  } else if (view === "ai") {
    const aiUser = await prisma.user.findFirst({ where: { name: "Omnis AI" }, select: { id: true } })
    messages = aiUser
      ? await prisma.chatMessage.findMany({
          where: {
            ...PUBLIC_MESSAGE_WHERE,
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

// ─── 방 하나 읽기 — MCP list_rooms · list_chat(view=room) ─────────────────────
// 권한은 roomAccess(#160 과 같은 규칙) 하나로 판단한다: 전사방은 누구나, 나머지는 지금 참여자만. 관리자 예외는 없다.

export const ROOM_KIND_LABEL: Record<string, string> = {
  COMPANY: "전사방", OMNIS_DM: "옴니스 1:1", GROUP: "단톡방", DM: "1:1",
}

/** 이 사람이 읽을 수 있는 방 전부 — 전사방 + 지금 참여자인 방. 업무방(표가 없다)은 view=task 로 읽는다 */
export async function readableRooms(userId: string): Promise<PickableRoom[]> {
  const rows = await prisma.chatRoom.findMany({
    where: { OR: [{ kind: "COMPANY" }, { kind: { in: ["OMNIS_DM", "GROUP", "DM"] }, members: { some: { userId } } }] },
    orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: 300,
    select: {
      id: true, kind: true, name: true, dmKey: true, createdAt: true, lastMessageAt: true,
      members: { orderBy: [{ joinedAt: "asc" }, { userId: "asc" }], select: { user: { select: { id: true, name: true } } } },
    },
  })
  return rows.map((r) => {
    const people = r.members.map((m) => m.user)
    return {
      id: r.id,
      kind: r.kind,
      title: peopleRoomTitle(r, people, userId),
      // 전사방은 참여자 행이 있어도 구성원 모두의 방이다 — 참여자로 고르지 않는다
      members: r.kind === "COMPANY" ? [] : people,
      lastAt: r.lastMessageAt ?? r.createdAt,
    }
  })
}

export interface RoomSummary extends PickableRoom {
  unread: number
}

/** list_rooms — 읽을 수 있는 방에 안 읽은 수 · 마지막 글 시각(메신저 목록과 같은 셈)을 붙인다. 최근 글 순 */
export async function listReadableRooms(userId: string): Promise<RoomSummary[]> {
  const [rooms, list] = await Promise.all([readableRooms(userId), listRooms(userId)])
  const byKey = new Map([...list.omnis, ...list.company, ...list.groups].map((r) => [r.key, r]))
  return rooms
    .map((r) => {
      const item = byKey.get(`room:${r.id}`)
      return { ...r, lastAt: item ? new Date(item.lastAt) : r.lastAt, unread: item?.unread ?? 0 }
    })
    .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime())
}

const ROOM_INCLUDE = {
  author: { select: { id: true, name: true } },
  externalSpeaker: EXTERNAL_SPEAKER_SELECT,
  task: { select: { slug: true } },
  files: { select: { id: true, name: true } },
} as const

export interface RoomFeedMessage {
  id: string
  createdAt: Date
  author: string
  content: string
  taskSlug: string | null
  files: { id: string; name: string }[]
}

/**
 * 방 하나의 글 — 오래된 것부터. since/until 은 그 시각 이상 · 미만, query 는 본문에 든 말(대소문자 무시).
 * 참여자가 아니면 글을 읽기 전에 거절한다. 지운 글은 내보내지 않는다.
 */
export async function readRoomFeed(input: {
  currentUserId: string
  roomId: string
  since?: Date
  until?: Date
  query?: string
  take?: number
}): Promise<{ error: string } | { messages: RoomFeedMessage[] }> {
  if ((await roomAccess(input.roomId, input.currentUserId)) !== "ok") return { error: "이 방을 볼 수 없습니다" }
  const take = Math.min(input.take ?? 100, 200)
  const rows = await prisma.chatMessage.findMany({
    where: {
      roomId: input.roomId,
      deletedAt: null,
      ...(input.since || input.until ? { createdAt: { ...(input.since ? { gte: input.since } : {}), ...(input.until ? { lt: input.until } : {}) } } : {}),
      ...(input.query ? { content: { contains: input.query, mode: "insensitive" as const } } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    include: ROOM_INCLUDE,
  })
  return {
    messages: rows.reverse().map((m) => ({
      id: m.id,
      createdAt: m.createdAt,
      author: displayAuthor(m.author, m.externalSpeaker).name,
      content: m.content,
      taskSlug: m.task?.slug ?? null,
      files: m.files,
    })),
  }
}
