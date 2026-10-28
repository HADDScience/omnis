// 채팅방 — 누가 어느 방을 읽는지, 메신저 왼쪽 목록에 무엇이 오는지.
// 계획: mydocs/plans/2026-10-28-omnis-messenger-agent.md (1단계 채팅방 모델)
//
// 방 종류(ChatRoomKind)
//   COMPANY  전사방 — 구성원 모두. 참여자 행이 없다
//   TASK     업무방 — 표가 없다. taskId 로 묶인 글을 목록이 방처럼 보여 준다(id 는 업무 id)
//   OMNIS_DM 옴니스 1:1 — 만든 사람만
//   GROUP    단톡방 — 5단계
import { prisma } from "@/lib/db"
import type { Prisma } from "@/generated/prisma/client"
import { SYSTEM_USER_ID } from "@/lib/system-user"

/** 「전체」 팀 채팅. 채팅 패널 · 업무 생성 · MCP 가 이 id 로 쓴다 */
export const COMPANY_ROOM_ID = "default-room"

/**
 * 모두가 읽는 글 — 전사방 글만. 옴니스 1:1 · 단톡 글은 그 방 참여자만 읽는다.
 * 방을 가리지 않고 글을 모으는 곳(피드 · 색인 · 지표)은 이 조건을 붙인다.
 * 업무 스레드 글은 전사방(default-room)에 있으므로 그대로 걸린다.
 */
export const PUBLIC_MESSAGE_WHERE = { room: { kind: "COMPANY" } } satisfies Prisma.ChatMessageWhereInput

export type RoomAccess = "ok" | "missing" | "forbidden"

/** 방을 읽고 쓸 수 있는가. 없는 방은 missing — 새 DB 에서 default-room 이 아직 없을 수 있어 호출자가 정한다 */
export async function roomAccess(roomId: string, userId: string): Promise<RoomAccess> {
  const room = await prisma.chatRoom.findUnique({
    where: { id: roomId },
    select: { kind: true, members: { where: { userId }, select: { userId: true } } },
  })
  if (!room) return "missing"
  if (room.kind === "COMPANY") return "ok"
  return room.members.length > 0 ? "ok" : "forbidden"
}

// ─── 목록 ────────────────────────────────────────────────

export interface RoomListItem {
  /** 주소에 쓰는 id. 업무방은 업무 id */
  id: string
  kind: "COMPANY" | "TASK" | "OMNIS_DM" | "GROUP"
  name: string
  /** 마지막 글 시각(ISO). 글이 없으면 방을 만든 시각 */
  lastAt: string
  /** 마지막 글 한 줄 — 「보낸 사람: 내용」 */
  preview: string | null
  /** 업무방만 */
  slug?: string
  status?: string
}

export interface RoomList {
  omnis: RoomListItem[]
  company: RoomListItem[]
  tasks: RoomListItem[]
  /** 단톡방 — 5단계에서 채운다 */
  groups: RoomListItem[]
}

/** 목록에 보일 업무방 수. 오래된 업무 스레드는 업무 탭에서 연다 */
const TASK_ROOM_LIMIT = 30
const PREVIEW_MAX = 60

/** 목록 한 줄 미리보기. 시스템 표식은 사람이 읽을 말로 */
export function previewText(content: string, kind: string): string {
  if (kind === "TASK_CREATED" || content.startsWith("__TASK_CREATED__")) return "업무가 생성되었습니다"
  const flat = content.replace(/^🤖\s*/, "").replace(/\s+/g, " ").trim()
  return flat.length > PREVIEW_MAX ? `${flat.slice(0, PREVIEW_MAX)}…` : flat
}

function authorLabel(authorId: string, name: string): string {
  return authorId === SYSTEM_USER_ID ? "옴니스" : name
}

export async function listRooms(userId: string): Promise<RoomList> {
  const [mine, companyRooms, taskHeads] = await Promise.all([
    // 내가 참여한 방(옴니스 1:1 · 단톡) — 최근 글 순
    prisma.chatRoom.findMany({
      where: { kind: { in: ["OMNIS_DM", "GROUP"] }, members: { some: { userId } } },
      orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: 100,
      select: {
        id: true, kind: true, name: true, createdAt: true, lastMessageAt: true,
        messages: {
          where: { deletedAt: null },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { content: true, kind: true, authorId: true, author: { select: { name: true } } },
        },
      },
    }),
    // 전사방은 여러 경로가 글을 써서 lastMessageAt 을 믿지 않는다 — 최신 글을 직접 읽는다
    prisma.chatRoom.findMany({
      where: { kind: "COMPANY" },
      select: {
        id: true, name: true, createdAt: true,
        messages: {
          where: { deletedAt: null },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { content: true, kind: true, createdAt: true, authorId: true, author: { select: { name: true } } },
        },
      },
    }),
    // 업무방 — 업무마다 마지막 글 하나. 보관한 업무는 뺀다
    prisma.$queryRaw<
      { taskId: string; createdAt: Date; content: string; kind: string; authorId: string; authorName: string; name: string; slug: string; status: string }[]
    >`
      SELECT * FROM (
        SELECT DISTINCT ON (m."taskId")
               m."taskId", m."createdAt", m.content, m.kind::text AS kind, m."authorId", u.name AS "authorName",
               t.name, t.slug, t.status::text AS status
          FROM "ChatMessage" m
          JOIN "Task" t ON t.id = m."taskId"
          JOIN "User" u ON u.id = m."authorId"
          JOIN "ChatRoom" r ON r.id = m."roomId"
         WHERE m."taskId" IS NOT NULL AND m."deletedAt" IS NULL AND t.archived = false AND r.kind = 'COMPANY'
         ORDER BY m."taskId", m."createdAt" DESC
      ) last
      ORDER BY last."createdAt" DESC
      LIMIT ${TASK_ROOM_LIMIT}`,
  ])

  const omnis: RoomListItem[] = []
  const groups: RoomListItem[] = []
  for (const r of mine) {
    const last = r.messages[0]
    const item: RoomListItem = {
      id: r.id,
      kind: r.kind,
      name: r.name,
      lastAt: (r.lastMessageAt ?? r.createdAt).toISOString(),
      preview: last ? `${authorLabel(last.authorId, last.author.name)}: ${previewText(last.content, last.kind)}` : null,
    }
    if (r.kind === "OMNIS_DM") omnis.push(item)
    else groups.push(item)
  }

  const company: RoomListItem[] = companyRooms
    .map((r) => {
      const last = r.messages[0]
      return {
        id: r.id,
        kind: "COMPANY" as const,
        name: r.name,
        lastAt: (last?.createdAt ?? r.createdAt).toISOString(),
        preview: last ? `${authorLabel(last.authorId, last.author.name)}: ${previewText(last.content, last.kind)}` : null,
      }
    })
    // 「전체」 를 맨 위에 — 카톡 이식으로 생긴 다른 전사방이 있어도 팀 채팅이 먼저다
    .sort((a, b) => (a.id === COMPANY_ROOM_ID ? -1 : b.id === COMPANY_ROOM_ID ? 1 : b.lastAt.localeCompare(a.lastAt)))

  const tasks: RoomListItem[] = taskHeads.map((t) => ({
    id: t.taskId,
    kind: "TASK",
    name: t.name,
    slug: t.slug,
    status: t.status,
    lastAt: t.createdAt.toISOString(),
    preview: `${authorLabel(t.authorId, t.authorName)}: ${previewText(t.content, t.kind)}`,
  }))

  return { omnis, company, tasks, groups }
}
