// 채팅방 — 누가 어느 방을 읽는지, 메신저 왼쪽 목록에 무엇이 오는지.
// 계획: mydocs/plans/2026-10-28-omnis-messenger-agent.md (1단계 채팅방 모델)
//
// 방 종류(ChatRoomKind)
//   COMPANY  전사방 — 구성원 모두. 참여자 행이 없다
//   TASK     업무방 — 표가 없다. taskId 로 묶인 글을 목록이 방처럼 보여 준다(id 는 업무 id)
//   OMNIS_DM 옴니스 1:1 — 만든 사람만
//   GROUP    단톡방 — 사람끼리. 참여자만(lib/chat-people.ts)
//   DM       사람끼리 1:1 — 두 사람만. 같은 두 사람의 방은 하나(dmKey)
import { prisma } from "@/lib/db"
import type { Prisma } from "@/generated/prisma/client"
import { SYSTEM_USER_ID } from "@/lib/system-user"
import { filterRooms, hiddenFromList, normalizeQuery, parseRoomKey, READ_BASELINE_KEY, roomKeyOf, type ChatFolderView } from "@/lib/chat-list"
import { ensureReadBaseline, listFolders } from "@/lib/chat-prefs"
import { peopleRoomTitle } from "@/lib/chat-people-rules"

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
  /** 읽음 · 즐겨찾기 · 폴더가 쓰는 방 키 — room:<id> · task:<taskId> (lib/chat-list.ts) */
  key: string
  kind: "COMPANY" | "TASK" | "OMNIS_DM" | "GROUP" | "DM"
  /** 1:1 은 상대 이름(보는 사람마다 다르다) */
  name: string
  /** 마지막 글 시각(ISO). 글이 없으면 방을 만든 시각 */
  lastAt: string
  /** 마지막 글 한 줄 — 「보낸 사람: 내용」 */
  preview: string | null
  /** 업무방만 */
  slug?: string
  status?: string
  /** 업무방만 — 규칙 폴더가 본다. 프로젝트 폴더는 projectId, 내 업무 폴더는 mine(담당 · 지시) */
  projectId?: string | null
  mine?: boolean
  /** 안 읽은 글 수 — 셈법은 lib/chat-list.ts countsAsUnread */
  unread: number
  favorite: boolean
}

export interface RoomList {
  omnis: RoomListItem[]
  company: RoomListItem[]
  tasks: RoomListItem[]
  /** 사람끼리 방 — 1:1(DM) · 단톡방(GROUP) */
  groups: RoomListItem[]
  /** 내 폴더(순서대로). 남의 폴더는 오지 않는다 */
  folders: ChatFolderView[]
  /** 검색어가 있으면 그 말로 거른 결과다 */
  query: string | null
}

/** 목록에 보일 업무방 수. 오래된 업무 스레드는 업무 탭에서 연다 — 즐겨찾기 · 폴더에 넣은 업무방은 이 수와 상관없이 온다 */
const TASK_ROOM_LIMIT = 30
/** 검색할 때 업무방은 최근 30개에 묶지 않고 이름 · 슬러그 · 마지막 글로 이만큼까지 찾는다 */
const TASK_SEARCH_LIMIT = 50
const PREVIEW_MAX = 60

/** 목록 한 줄 미리보기. 시스템 표식은 사람이 읽을 말로, 옴니스 답의 마크다운 기호(**, #, 표 칸, 각주)는 뗀다 */
export function previewText(content: string, kind: string): string {
  if (kind === "TASK_CREATED" || content.startsWith("__TASK_CREATED__")) return "업무가 생성되었습니다"
  const flat = content
    .replace(/^🤖\s*/, "")
    .replace(/\*\*|__|`|^#{1,6}\s+|\|/gm, "")
    .replace(/\s?\[\d+(?:\s*[,，~–-]\s*\d+)*\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
  return flat.length > PREVIEW_MAX ? `${flat.slice(0, PREVIEW_MAX)}…` : flat
}

function authorLabel(authorId: string, name: string): string {
  return authorId === SYSTEM_USER_ID ? "옴니스" : name
}

type TaskHead = {
  taskId: string; createdAt: Date; content: string; kind: string; authorId: string; authorName: string
  name: string; slug: string; status: string; projectId: string | null; mine: boolean
}

/**
 * 업무마다 마지막 글 하나. 보관한 업무는 뺀다.
 * `taskIds` 가 있으면 그 업무만, `pattern` 이 있으면 업무 이름 · 슬러그 · 마지막 글 · 보낸 사람으로 거른다.
 * 조건은 SQL 조각(Prisma.sql)이 아니라 매개변수로 넘긴다 — next dev(webpack) 에서는 조각이 jsonb 매개변수로 직렬화돼
 * 「argument of AND must be type boolean, not type jsonb」 로 실패했다(tsx 에서는 통과한다).
 */
function taskHeads(userId: string, opts: { taskIds?: string[]; pattern?: string; limit: number }) {
  const ids = opts.taskIds ?? null
  const pattern = opts.pattern ?? null
  return prisma.$queryRaw<TaskHead[]>`
    SELECT * FROM (
      SELECT DISTINCT ON (m."taskId")
             m."taskId", m."createdAt", m.content, m.kind::text AS kind, m."authorId", u.name AS "authorName",
             t.name, t.slug, t.status::text AS status, t."projectId",
             -- 내 업무 폴더 기준 — 업무 탭의 i-assigned(지시) · i-own(담당)과 같다
             (t."instructorId" = ${userId}
              OR EXISTS (SELECT 1 FROM "TaskAssignee" a WHERE a."taskId" = t.id AND a."userId" = ${userId})) AS mine
        FROM "ChatMessage" m
        JOIN "Task" t ON t.id = m."taskId"
        JOIN "User" u ON u.id = m."authorId"
        JOIN "ChatRoom" r ON r.id = m."roomId"
       WHERE m."taskId" IS NOT NULL AND m."deletedAt" IS NULL AND t.archived = false AND r.kind = 'COMPANY'
         AND (${ids}::text[] IS NULL OR m."taskId" = ANY(${ids}::text[]))
       ORDER BY m."taskId", m."createdAt" DESC
    ) last
    WHERE ${pattern}::text IS NULL
       OR last.name ILIKE ${pattern}::text OR last.slug ILIKE ${pattern}::text
       OR last.content ILIKE ${pattern}::text OR last."authorName" ILIKE ${pattern}::text
    ORDER BY last."createdAt" DESC
    LIMIT ${opts.limit}`
}

/** 규칙 폴더 하나가 끌어오는 업무방 수 상한(최근에 고친 업무부터). 넘는 것은 검색으로 찾는다 */
const RULE_TASK_LIMIT = 200

/** 업무방이 있는 업무 — 전사방에 지우지 않은 글이 하나라도 있다. 상한을 글 없는 업무가 먹지 않게 */
const HAS_ROOM = { some: { deletedAt: null, room: { kind: "COMPANY" as const } } }

/** 내 규칙 폴더(내 업무 · 프로젝트)에 드는 업무 id. 보관한 업무는 뺀다(업무방 목록과 같다) */
async function ruleFolderTaskIds(userId: string, folders: ChatFolderView[]): Promise<string[]> {
  const wantMine = folders.some((f) => f.rule === "MY_TASKS")
  const projectIds = folders.flatMap((f) => (f.rule === "PROJECT" && f.projectId ? [f.projectId] : []))
  const [mine, inProjects] = await Promise.all([
    wantMine
      ? prisma.task.findMany({
          where: { archived: false, messages: HAS_ROOM, OR: [{ instructorId: userId }, { assignees: { some: { userId } } }] },
          orderBy: { updatedAt: "desc" },
          take: RULE_TASK_LIMIT,
          select: { id: true },
        })
      : [],
    projectIds.length
      ? prisma.task.findMany({
          where: { archived: false, messages: HAS_ROOM, projectId: { in: projectIds } },
          orderBy: { updatedAt: "desc" },
          take: RULE_TASK_LIMIT * projectIds.length,
          select: { id: true },
        })
      : [],
  ])
  return [...mine, ...inProjects].map((t) => t.id)
}

/** ILIKE 에 넣을 글자 — `%` · `_` · `\` 를 이스케이프한다(Prisma 의 contains 도, 날 SQL 도 해 주지 않는다) */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

/**
 * 안 읽은 글 수 — 방 키마다. 규칙의 정본은 lib/chat-list.ts countsAsUnread 이고 SQL 이 같은 규칙을 센다:
 * 지운 글 · 내 글 제외, 시스템 계정 글은 옴니스 1:1 방에서만 센다, 그 방을 읽은 시각(없으면 기준 시각) 뒤의 글.
 */
async function unreadCounts(userId: string, roomIds: string[], taskIds: string[], baseline: Date): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const [byRoom, byTask] = await Promise.all([
    roomIds.length === 0
      ? []
      : prisma.$queryRaw<{ key: string; n: number }[]>`
          SELECT 'room:' || m."roomId" AS key, COUNT(*)::int AS n
            FROM "ChatMessage" m
            JOIN "ChatRoom" r ON r.id = m."roomId"
            LEFT JOIN "ChatRoomPref" p ON p."userId" = ${userId} AND p."roomKey" = 'room:' || m."roomId"
           WHERE m."roomId" = ANY(${roomIds}::text[]) AND m."deletedAt" IS NULL AND m."authorId" <> ${userId}
             AND (m."authorId" <> ${SYSTEM_USER_ID} OR r.kind = 'OMNIS_DM')
             AND m."createdAt" > COALESCE(p."lastReadAt", ${baseline})
           GROUP BY m."roomId"`,
    taskIds.length === 0
      ? []
      : prisma.$queryRaw<{ key: string; n: number }[]>`
          SELECT 'task:' || m."taskId" AS key, COUNT(*)::int AS n
            FROM "ChatMessage" m
            JOIN "ChatRoom" r ON r.id = m."roomId" AND r.kind = 'COMPANY'
            LEFT JOIN "ChatRoomPref" p ON p."userId" = ${userId} AND p."roomKey" = 'task:' || m."taskId"
           WHERE m."taskId" = ANY(${taskIds}::text[]) AND m."deletedAt" IS NULL AND m."authorId" <> ${userId}
             AND m."authorId" <> ${SYSTEM_USER_ID}
             AND m."createdAt" > COALESCE(p."lastReadAt", ${baseline})
           GROUP BY m."taskId"`,
  ])
  for (const r of [...byRoom, ...byTask]) out.set(r.key, r.n)
  return out
}

/**
 * 내 방 목록. 검색어(`q`)가 있으면 방 이름 · 업무 이름 · 슬러그 · 마지막 글 미리보기로 거른다 — 칩과 상관없이 전체에서.
 * 남의 1:1 방은 어느 경우에도 오지 않는다(참여자 조건).
 */
export async function listRooms(userId: string, opts: { q?: string } = {}): Promise<RoomList> {
  const query = opts.q ? normalizeQuery(opts.q) : ""
  const [baseline, prefs, folders] = await Promise.all([
    ensureReadBaseline(userId),
    prisma.chatRoomPref.findMany({ where: { userId, roomKey: { not: READ_BASELINE_KEY } }, select: { roomKey: true, favorite: true, hiddenAt: true } }),
    listFolders(userId),
  ])
  const favorites = new Set(prefs.filter((p) => p.favorite).map((p) => p.roomKey))
  // 지운 옴니스 대화 · 숨긴 사람 1:1 (숨긴 뒤 새 글이 오면 다시 보인다 — lib/chat-list.ts hiddenFromList)
  const hidden = new Map(prefs.flatMap((p) => (p.hiddenAt ? [[p.roomKey, p.hiddenAt.toISOString()] as const] : [])))

  // 최근 30개 밖이라도 즐겨찾기 · 수동 폴더에 넣은 업무방, 규칙 폴더(내 업무 · 프로젝트)에 드는 업무방은
  // 목록에 와야 칩에서 보인다. 규칙 폴더 쪽은 업무 수가 많을 수 있어 RULE_TASK_LIMIT 개까지
  const ruleTaskIds = query ? [] : await ruleFolderTaskIds(userId, folders)
  const pinnedTaskIds = [
    ...new Set([
      ...[...favorites, ...folders.flatMap((f) => f.roomKeys)]
        .map(parseRoomKey)
        .filter((k): k is { type: "task"; id: string } => k?.type === "task")
        .map((k) => k.id),
      ...ruleTaskIds,
    ]),
  ]

  const [mine, companyRooms, recentTasks, pinnedTasks] = await Promise.all([
    // 내가 참여한 방(옴니스 1:1 · 사람끼리 1:1 · 단톡) — 최근 글 순
    prisma.chatRoom.findMany({
      where: { kind: { in: ["OMNIS_DM", "GROUP", "DM"] }, members: { some: { userId } } },
      orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: 100,
      select: {
        id: true, kind: true, name: true, createdAt: true, lastMessageAt: true,
        // 1:1 이름(상대 이름)을 정하려고 — 사람끼리 1:1 만 쓴다
        members: { where: { room: { kind: "DM" } }, select: { user: { select: { id: true, name: true } } } },
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
    query ? taskHeads(userId, { pattern: likePattern(query), limit: TASK_SEARCH_LIMIT }) : taskHeads(userId, { limit: TASK_ROOM_LIMIT }),
    pinnedTaskIds.length === 0 || query
      ? ([] as TaskHead[])
      : taskHeads(userId, { taskIds: pinnedTaskIds, limit: pinnedTaskIds.length }),
  ])

  const omnis: RoomListItem[] = []
  const groups: RoomListItem[] = []
  for (const r of mine) {
    const last = r.messages[0]
    const item: RoomListItem = {
      id: r.id,
      key: roomKeyOf({ kind: r.kind, id: r.id }),
      kind: r.kind,
      name: peopleRoomTitle(r, r.members.map((m) => m.user), userId),
      lastAt: (r.lastMessageAt ?? r.createdAt).toISOString(),
      preview: last ? `${authorLabel(last.authorId, last.author.name)}: ${previewText(last.content, last.kind)}` : null,
      unread: 0,
      favorite: false,
    }
    if (hiddenFromList(item, hidden.get(item.key) ?? null)) continue
    if (r.kind === "OMNIS_DM") omnis.push(item)
    else groups.push(item)
  }

  const company: RoomListItem[] = companyRooms
    .map((r) => {
      const last = r.messages[0]
      return {
        id: r.id,
        key: roomKeyOf({ kind: "COMPANY", id: r.id }),
        kind: "COMPANY" as const,
        name: r.name,
        lastAt: (last?.createdAt ?? r.createdAt).toISOString(),
        preview: last ? `${authorLabel(last.authorId, last.author.name)}: ${previewText(last.content, last.kind)}` : null,
        unread: 0,
        favorite: false,
      }
    })
    // 「전체」 를 맨 위에 — 카톡 이식으로 생긴 다른 전사방이 있어도 팀 채팅이 먼저다
    .sort((a, b) => (a.id === COMPANY_ROOM_ID ? -1 : b.id === COMPANY_ROOM_ID ? 1 : b.lastAt.localeCompare(a.lastAt)))

  const seenTasks = new Set<string>()
  const tasks: RoomListItem[] = []
  for (const t of [...recentTasks, ...pinnedTasks]) {
    if (seenTasks.has(t.taskId)) continue
    seenTasks.add(t.taskId)
    tasks.push({
      id: t.taskId,
      key: roomKeyOf({ kind: "TASK", id: t.taskId }),
      kind: "TASK",
      name: t.name,
      slug: t.slug,
      status: t.status,
      projectId: t.projectId,
      mine: t.mine,
      lastAt: t.createdAt.toISOString(),
      preview: `${authorLabel(t.authorId, t.authorName)}: ${previewText(t.content, t.kind)}`,
      unread: 0,
      favorite: false,
    })
  }

  // 검색 — 업무방은 SQL 이 이미 걸렀다. 나머지는 미리보기까지 만든 뒤 같은 규칙(matchesRoomQuery)으로
  const pick = (rows: RoomListItem[]) => (query ? filterRooms(rows, query) : rows)
  const result = { omnis: pick(omnis), company: pick(company), tasks, groups: pick(groups) }

  const all = [...result.omnis, ...result.company, ...result.tasks, ...result.groups]
  const counts = await unreadCounts(
    userId,
    all.filter((r) => r.kind !== "TASK").map((r) => r.id),
    result.tasks.map((r) => r.id),
    baseline,
  )
  for (const r of all) {
    r.unread = counts.get(r.key) ?? 0
    r.favorite = favorites.has(r.key)
  }

  return { ...result, folders, query: query || null }
}
