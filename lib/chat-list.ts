// 메신저 방 목록의 칩 · 폴더 · 안 읽음 · 검색 규칙 — 순수 함수만 둔다(브라우저와 서버가 같이 쓴다, prisma 없음).
// 화면: components/messenger/room-list.tsx · 서버: lib/chat-rooms.ts(listRooms) · lib/chat-prefs.ts
// 결정과 이유: mydocs/working/2026-10-28-omnis-messenger.md 「2-b. 방 목록 필터 · 폴더 · 검색」

// ─── 방 키 ───────────────────────────────────────────────
//
// 읽음 · 즐겨찾기 · 폴더는 방 id 가 아니라 방 키로 저장한다.
// 전사방은 참여자 행이 없고 업무방은 표가 없다(taskId 로 묶인 가상 방) — ChatRoom id 하나로는 둘을 다 가리킬 수 없다.
//   room:<ChatRoom.id>   전사방 · 옴니스 1:1 · 단톡방
//   task:<Task.id>       업무방

export type RoomKind = "COMPANY" | "TASK" | "OMNIS_DM" | "GROUP"

/** 「안 읽음을 세기 시작한 시각」 한 줄의 키. API 로는 받지 않는다(parseRoomKey 가 거부한다) */
export const READ_BASELINE_KEY = "*"

const KEY_ID = /^[A-Za-z0-9_-]{1,64}$/

export function roomKeyOf(room: { kind: RoomKind; id: string }): string {
  return room.kind === "TASK" ? `task:${room.id}` : `room:${room.id}`
}

export function parseRoomKey(key: unknown): { type: "room" | "task"; id: string } | null {
  if (typeof key !== "string") return null
  const m = /^(room|task):(.+)$/.exec(key)
  if (!m || !KEY_ID.test(m[2])) return null
  return { type: m[1] as "room" | "task", id: m[2] }
}

/** 지금 주소가 가리키는 방. /chat · /chat/new 는 방이 아니다 */
export function roomKeyFromPath(pathname: string): string | null {
  const task = /^\/chat\/task\/([^/]+)\/?$/.exec(pathname)
  if (task) return `task:${decodeURIComponent(task[1])}`
  const room = /^\/chat\/([^/]+)\/?$/.exec(pathname)
  if (room && room[1] !== "new" && room[1] !== "task") return `room:${decodeURIComponent(room[1])}`
  return null
}

/**
 * 이 사람이 이 방 키를 폴더 · 즐겨찾기 · 읽음에 쓸 수 있는가.
 * 남의 1:1 방 키는 forbidden — 폴더에 넣으면 목록에 그 방이 있다는 것 자체가 샌다.
 * 업무방은 전사방 글이라 업무가 있으면 누구나 본다.
 */
export function decideRoomKeyAccess(input: {
  key: unknown
  /** room: 키일 때 그 방(없으면 null) */
  room?: { kind: RoomKind; isMember: boolean } | null
  /** task: 키일 때 업무가 있는가 */
  taskExists?: boolean
}): "ok" | "invalid" | "missing" | "forbidden" {
  const parsed = parseRoomKey(input.key)
  if (!parsed) return "invalid"
  if (parsed.type === "task") return input.taskExists ? "ok" : "missing"
  const room = input.room
  if (!room) return "missing"
  // 업무방은 표가 없다 — room: 키로 TASK 종류가 오면 잘못 만든 키다
  if (room.kind === "TASK") return "invalid"
  if (room.kind === "COMPANY") return "ok"
  return room.isMember ? "ok" : "forbidden"
}

// ─── 폴더 ────────────────────────────────────────────────

/** 추천 폴더 — 규칙 폴더. 방 종류로 저절로 채운다 */
export const FOLDER_RULES = ["COMPANY", "TASK", "GROUP"] as const
export type FolderRule = (typeof FOLDER_RULES)[number]

export const RULE_FOLDER_INFO: Record<FolderRule, { name: string; hint: string }> = {
  COMPANY: { name: "전사방", hint: "구성원 모두가 있는 방" },
  TASK: { name: "업무방", hint: "업무 스레드 — 새 업무방이 생기면 저절로 들어와요" },
  GROUP: { name: "단톡방", hint: "팀원과 만든 단톡방" },
}

export const FOLDER_NAME_MAX = 20
export const FOLDER_LIMIT = 20

export interface ChatFolderView {
  id: string
  name: string
  rule: FolderRule | null
  order: number
  /** 수동 폴더에 넣은 방 키. 규칙 폴더는 비어 있다 */
  roomKeys: string[]
}

export function ruleMatches(rule: FolderRule, kind: RoomKind): boolean {
  return kind === rule
}

export function folderHasRoom(folder: ChatFolderView, room: { key: string; kind: RoomKind }): boolean {
  return folder.rule ? ruleMatches(folder.rule, room.kind) : folder.roomKeys.includes(room.key)
}

// ─── 칩 ──────────────────────────────────────────────────

/** 고정 칩. 지울 수 없고 순서도 이대로다 */
export const FIXED_CHIPS = [
  { id: "all", label: "전체" },
  { id: "omnis", label: "옴니스" },
  { id: "unread", label: "안읽음" },
  { id: "favorite", label: "즐겨찾기" },
] as const

export type FixedChipId = (typeof FIXED_CHIPS)[number]["id"]
/** 폴더 칩은 `folder:<id>` */
export type ChipId = FixedChipId | `folder:${string}`

export interface ListRoom {
  key: string
  kind: RoomKind
  name: string
  lastAt: string
  preview: string | null
  slug?: string
  unread: number
  favorite: boolean
}

/** 저장해 둔 칩이 아직 있는가 — 지운 폴더의 칩이면 「전체」 로 */
export function resolveChip(saved: string | null | undefined, folders: ChatFolderView[]): ChipId {
  if (!saved) return "all"
  if (FIXED_CHIPS.some((c) => c.id === saved)) return saved as FixedChipId
  if (saved.startsWith("folder:") && folders.some((f) => `folder:${f.id}` === saved)) return saved as ChipId
  return "all"
}

/** 칩 하나에 들어가는 방 — 방 종류로 칸을 나누지 않고 최근 글 순 한 목록 */
export function roomsInChip<T extends ListRoom>(rooms: T[], chip: ChipId, folders: ChatFolderView[]): T[] {
  let picked: T[]
  if (chip === "all") picked = rooms
  else if (chip === "omnis") picked = rooms.filter((r) => r.kind === "OMNIS_DM")
  else if (chip === "unread") picked = rooms.filter((r) => r.unread > 0)
  else if (chip === "favorite") picked = rooms.filter((r) => r.favorite)
  else {
    const folder = folders.find((f) => `folder:${f.id}` === chip)
    picked = folder ? rooms.filter((r) => folderHasRoom(folder, r)) : []
  }
  return sortByRecent(picked)
}

export function sortByRecent<T extends { lastAt: string }>(rooms: T[]): T[] {
  return [...rooms].sort((a, b) => b.lastAt.localeCompare(a.lastAt))
}

/** 「안읽음」 칩 배지 — 안 읽은 글이 있는 방의 수 */
export function unreadRoomCount(rooms: { unread: number }[]): number {
  return rooms.reduce((n, r) => n + (r.unread > 0 ? 1 : 0), 0)
}

/** 배지 글자. 100 부터는 「99+」 */
export function unreadLabel(n: number): string {
  return n > 99 ? "99+" : String(n)
}

// ─── 안 읽음 ─────────────────────────────────────────────
//
// 서버는 같은 규칙을 SQL 로 센다(lib/chat-rooms.ts 의 unread 질의). 이 함수가 규칙의 정본이고,
// scripts/verify-chat-folders.ts 가 실제 DB 에서 SQL 과 이 함수의 답이 같은지 맞춰 본다.

/** 방의 「여기까지 읽었다」 시각 — 그 방을 한 번도 안 열었으면 안 읽음을 세기 시작한 시각 */
export function effectiveReadAt(roomReadAt: Date | null | undefined, baseline: Date): Date {
  return roomReadAt ?? baseline
}

/**
 * 이 글이 안 읽은 글인가.
 * - 지운 글 · 내가 쓴 글은 세지 않는다
 * - 시스템 계정 글(🤖 업무 재구성 · 완료 확인 대기)은 전사방 · 업무방에서 세지 않는다 — 사람 글 뒤에 저절로 붙는 글이라
 *   한 번 대화에 배지가 두 번 오른다. 옴니스 1:1 방에서는 센다 — 옴니스 답이 그 방의 상대 글이다
 */
export function countsAsUnread(
  msg: { authorId: string; createdAt: Date; deletedAt?: Date | null },
  ctx: { userId: string; systemUserId: string; roomKind: RoomKind; readAt: Date },
): boolean {
  if (msg.deletedAt) return false
  if (msg.authorId === ctx.userId) return false
  if (msg.authorId === ctx.systemUserId && ctx.roomKind !== "OMNIS_DM") return false
  return msg.createdAt.getTime() > ctx.readAt.getTime()
}

// ─── 검색 ────────────────────────────────────────────────

/**
 * 목록 검색 — 방 이름 · 업무 슬러그 · 마지막 글 미리보기(「보낸 사람: 내용」)에 글자가 들어 있는가.
 * 대소문자 · 앞뒤 공백 · 맨 앞 `#`(업무 슬러그를 #슬러그 로 치는 버릇)은 따지지 않는다.
 * 고른 칩과 상관없이 전체에서 찾는다 — 화면이 칩을 무시한다(문서 「2-b」).
 */
export function normalizeQuery(q: string): string {
  return q.trim().replace(/^#/, "").trim().toLowerCase()
}

export function matchesRoomQuery(room: { name: string; slug?: string; preview: string | null }, q: string): boolean {
  const needle = normalizeQuery(q)
  if (!needle) return true
  return [room.name, room.slug ?? "", room.preview ?? ""].some((s) => s.toLowerCase().includes(needle))
}

export function filterRooms<T extends { name: string; slug?: string; preview: string | null }>(rooms: T[], q: string): T[] {
  return rooms.filter((r) => matchesRoomQuery(r, q))
}
