// 채팅 피드 읽기 — 화면(app/api/chat/feed)과 MCP(list_chat)가 같은 길을 쓴다.
// 라우트에서 그대로 옮겼다(2026-09-16). 보기(view)마다 무엇을 모으는지가 여기 한 곳에 있다.
import { prisma } from "@/lib/db"
import { listRooms, PUBLIC_MESSAGE_WHERE, roomAccess } from "@/lib/chat-rooms"
import { peopleRoomTitle } from "@/lib/chat-people-rules"
import { displayAuthor, EXTERNAL_SPEAKER_SELECT, externalSpeakerLabel } from "@/lib/external-speaker"
import type { PickableRoom } from "@/lib/chat-room-pick"
import { escapeLike, keepPermitted, searchableRooms, splitWords, type RoomHit } from "@/lib/chat-room-search"

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

// ─── 방 글 낱말 검색 — MCP search_knowledge 가 의미 검색 결과에 섞는다(lib/chat-room-search.ts) ─────────────
// 방은 readableRooms 가 고른다 — list_rooms · list_chat(view=room)과 같은 권한(지금 참여자인 방만).
// 전사방은 뺀다: 그 글은 이미 임베딩 색인(CHAT_MESSAGE)으로 찾는다. 쿼리는 방 목록 1번 + 검색 1번으로, 방 수와 무관하다.

type RoomSearchRow = {
  hitId: string
  hitRoomId: string
  hitCreatedAt: Date
  hitContent: string
  hitAuthor: string
  hitExtName: string | null
  hitExtOrg: string | null
  hitExtTitle: string | null
  score: number
  /** 0 = 맞은 글 자신, -1 앞 대화, 1 뒤 대화 */
  dir: number
  ctxCreatedAt: Date | null
  ctxContent: string | null
  ctxAuthor: string | null
  ctxExtName: string | null
  ctxExtOrg: string | null
  ctxExtTitle: string | null
}

const authorLabel = (user: string | null, extName: string | null, extOrg: string | null, extTitle: string | null) =>
  extName ? externalSpeakerLabel({ name: extName, org: extOrg, title: extTitle }) : (user ?? "")

/**
 * 내가 지금 참여자인 단톡 · 1:1 · 옴니스 1:1 방에서 낱말이 든 글. 맞은 낱말 수 → 최근 순.
 * 글마다 앞뒤 대화 2줄씩을 붙인다(같은 방, 지운 글 제외).
 */
export async function searchRoomMessages(input: { currentUserId: string; query: string; take: number }): Promise<RoomHit[]> {
  const words = splitWords(input.query)
  if (words.length === 0 || input.take <= 0) return []
  const rooms = searchableRooms(await readableRooms(input.currentUserId))
  if (rooms.length === 0) return []
  // 자리표($1…)와 값 배열을 직접 만든다. 낱말은 값으로만 넘긴다(문자열에 이어 붙이지 않는다).
  // Prisma.sql 조각을 겹쳐 넘기면 dev 묶음에서 조각이 jsonb 값으로 넘어갔다(2026-11-10, 「argument of AND must be type boolean」)
  const values: unknown[] = [rooms.map((r) => r.id), input.take]
  const like = words.map((w) => {
    values.push(`%${escapeLike(w)}%`)
    return `m."content" ILIKE $${values.length} ESCAPE '\\'`
  })
  const sql = `
    WITH hits AS (
      SELECT m."id", m."roomId", m."createdAt", m."content", m."authorId", m."externalSpeakerId",
             (${like.map((l) => `(CASE WHEN ${l} THEN 1 ELSE 0 END)`).join(" + ")})::int AS "score"
      FROM "ChatMessage" m
      WHERE m."roomId" = ANY($1::text[])
        AND m."deletedAt" IS NULL
        AND (${like.join(" OR ")})
      ORDER BY "score" DESC, m."createdAt" DESC, m."id" DESC
      LIMIT $2
    )
    SELECT
      h."id" AS "hitId", h."roomId" AS "hitRoomId", h."createdAt" AS "hitCreatedAt", h."content" AS "hitContent", h."score",
      hu."name" AS "hitAuthor", he."name" AS "hitExtName", he."org" AS "hitExtOrg", he."title" AS "hitExtTitle",
      c."dir", c."createdAt" AS "ctxCreatedAt", c."content" AS "ctxContent",
      cu."name" AS "ctxAuthor", ce."name" AS "ctxExtName", ce."org" AS "ctxExtOrg", ce."title" AS "ctxExtTitle"
    FROM hits h
    JOIN "User" hu ON hu."id" = h."authorId"
    LEFT JOIN "ExternalSpeaker" he ON he."id" = h."externalSpeakerId"
    LEFT JOIN LATERAL (
      (SELECT p."createdAt", p."content", p."authorId", p."externalSpeakerId", -1 AS "dir"
         FROM "ChatMessage" p
        WHERE p."roomId" = h."roomId" AND p."deletedAt" IS NULL AND (p."createdAt", p."id") < (h."createdAt", h."id")
        ORDER BY p."createdAt" DESC, p."id" DESC LIMIT 2)
      UNION ALL
      (SELECT n."createdAt", n."content", n."authorId", n."externalSpeakerId", 1 AS "dir"
         FROM "ChatMessage" n
        WHERE n."roomId" = h."roomId" AND n."deletedAt" IS NULL AND (n."createdAt", n."id") > (h."createdAt", h."id")
        ORDER BY n."createdAt" ASC, n."id" ASC LIMIT 2)
    ) c ON TRUE
    LEFT JOIN "User" cu ON cu."id" = c."authorId"
    LEFT JOIN "ExternalSpeaker" ce ON ce."id" = c."externalSpeakerId"
  `
  const rows = await prisma.$queryRawUnsafe<RoomSearchRow[]>(sql, ...values)

  const byRoom = new Map(rooms.map((r) => [r.id, r]))
  const hits = new Map<string, RoomHit>()
  for (const row of rows) {
    const room = byRoom.get(row.hitRoomId)
    if (!room) continue
    let hit = hits.get(row.hitId)
    if (!hit) {
      hit = {
        messageId: row.hitId, roomId: row.hitRoomId, roomTitle: room.title, roomKind: room.kind,
        createdAt: row.hitCreatedAt, author: authorLabel(row.hitAuthor, row.hitExtName, row.hitExtOrg, row.hitExtTitle),
        content: row.hitContent, score: Number(row.score), before: [], after: [],
      }
      hits.set(row.hitId, hit)
    }
    if (row.ctxCreatedAt && row.ctxContent !== null) {
      const line = { createdAt: row.ctxCreatedAt, author: authorLabel(row.ctxAuthor, row.ctxExtName, row.ctxExtOrg, row.ctxExtTitle), content: row.ctxContent }
      ;(Number(row.dir) < 0 ? hit.before : hit.after).push(line)
    }
  }
  // 방 목록 밖 글은 쿼리가 고르지 않지만, 여기서 한 번 더 막는다
  const ordered = keepPermitted([...hits.values()], rooms).sort((a, b) => b.score - a.score || b.createdAt.getTime() - a.createdAt.getTime() || (a.messageId < b.messageId ? 1 : -1))
  for (const h of ordered) {
    h.before.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    h.after.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  }
  return ordered
}
