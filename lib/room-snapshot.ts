// 방 저장본 — 방을 누르면 서버를 기다리지 않고 이것으로 진짜 방 화면을 그리고, 저장 시각 뒤의 새 글 · 고친 글만 받는다.
// 범위와 지우는 때: lib/chat-cache.ts 머리 주석 · mydocs/manual/ux-rules.md 「기기 저장」.
import { apiUrl } from "@/lib/base-path"
import { deleteCache, listCacheKeys, readCache, writeCache } from "@/lib/chat-cache"
import type { PeopleRoomView } from "@/lib/chat-people-rules"
import type { RoomListItem } from "@/lib/chat-rooms"

export interface RoomSnapshot<M = unknown> {
  messages: M[]
  /** 이 저장본이 반영한 서버 시각 — 다시 열 때 그 뒤에 고치거나 지운 글을 묻는다 */
  checkedAt: string
  /** 참여자만 보는 방 — 목록에서 사라지면(빠졌거나 나갔다) 지운다 */
  membersOnly?: boolean
  /** 사람끼리 방의 머리줄 · @ 후보 */
  people?: PeopleRoomView
}

/** 업무방 · 옴니스 방이 쓰는 줄 — 입장 화면이 보낸 사람과 본문만 그린다 */
export interface SnapshotLine {
  id: string
  author: { id: string; name: string }
  mine?: boolean
  fromOmnis?: boolean
  content: string
  createdAt: string
  deletedAt?: string | null
  /** 카톡에서 옮긴 글이면 `kakao:…` · 붙은 첨부 — 첨부를 못 받은 카톡 글을 흐린 칸으로 그릴 때 본다(lib/kakao-placeholder.ts) */
  sourceId?: string | null
  files?: unknown[]
}

export const SNAPSHOT_MESSAGES = 30
const PREFIX = "snap:"
const PREFETCH_ROOMS = 6
const PREFETCH_CONCURRENCY = 2

const memory = new Map<string, RoomSnapshot>()
const inflight = new Set<string>()
const memKey = (userId: string, roomKey: string) => `${userId}:${roomKey}`

/** 서버 페이지 없이 바로 그리는 방 */
export const FAST_KINDS: ReadonlySet<RoomListItem["kind"]> = new Set(["COMPANY", "DM", "GROUP"])
export const isFastRoom = (room: Pick<RoomListItem, "kind">) => FAST_KINDS.has(room.kind)

export function peekSnapshot<M>(userId: string, roomKey: string): RoomSnapshot<M> | null {
  return (memory.get(memKey(userId, roomKey)) as RoomSnapshot<M> | undefined) ?? null
}

export async function readSnapshot<M>(userId: string, roomKey: string): Promise<RoomSnapshot<M> | null> {
  const hit = peekSnapshot<M>(userId, roomKey)
  if (hit) return hit
  const saved = await readCache<RoomSnapshot<M>>(userId, PREFIX + roomKey)
  // 읽는 사이에 새로 쓴 것이 있으면 그쪽이 새것이다
  const newer = peekSnapshot<M>(userId, roomKey)
  if (newer) return newer
  if (saved) memory.set(memKey(userId, roomKey), saved)
  return saved
}

/** 글을 바꿔 쓴다. 참여자 정보는 함께 받지 않았으면 앞의 것을 남긴다 */
export function writeSnapshot<M>(
  userId: string,
  roomKey: string,
  next: { messages: M[]; checkedAt: string; membersOnly?: boolean },
) {
  if (!userId) return
  const before = peekSnapshot(userId, roomKey)
  const snapshot: RoomSnapshot<M> = { ...next, messages: next.messages.slice(-SNAPSHOT_MESSAGES), ...(before?.people ? { people: before.people } : {}) }
  memory.set(memKey(userId, roomKey), snapshot)
  void writeCache(userId, PREFIX + roomKey, snapshot)
}

/** 참여자 정보만 고친다 */
export async function writeSnapshotPeople(userId: string, roomKey: string, people: PeopleRoomView) {
  const before = await readSnapshot(userId, roomKey)
  const snapshot: RoomSnapshot = { messages: before?.messages ?? [], checkedAt: before?.checkedAt ?? new Date(0).toISOString(), membersOnly: true, people }
  memory.set(memKey(userId, roomKey), snapshot)
  void writeCache(userId, PREFIX + roomKey, snapshot)
}

export function dropSnapshot(userId: string, roomKey: string) {
  memory.delete(memKey(userId, roomKey))
  void deleteCache(userId, PREFIX + roomKey)
}

/** 응답 Date 머리의 서버 시각. 없으면 지금에서 1분 뺀다 — 고친 글을 놓치는 쪽으로 틀리지 않게 */
export function serverTimeOf(res: Pick<Response, "headers">): string {
  const date = res.headers.get("date")
  const at = date ? new Date(date).getTime() : Number.NaN
  return new Date(Number.isNaN(at) ? Date.now() - 60_000 : at).toISOString()
}

/** 목록에 없는 방의 키 — 참여자만 보는 방의 저장본만 지운다(업무방 · 옴니스 방은 목록이 일부만 보여 준다) */
export function roomsToForget(savedKeys: string[], listedKeys: ReadonlySet<string>): string[] {
  return savedKeys.filter((k) => k.startsWith("room:") && !listedKeys.has(k))
}

/** 받아 둘 방 — 위쪽 방 가운데 저장본의 마지막 글이 목록의 마지막 글보다 오래된 것 */
export function roomsToPrefetch<R extends Pick<RoomListItem, "key" | "kind" | "lastAt">>(
  rooms: R[],
  lastSavedAt: (key: string) => string | undefined,
  limit = PREFETCH_ROOMS,
): R[] {
  return rooms
    .filter(isFastRoom)
    .slice(0, limit)
    .filter((room) => {
      const last = lastSavedAt(room.key)
      return !last || new Date(last).getTime() < new Date(room.lastAt).getTime()
    })
}

/**
 * 목록을 받은 뒤 놀 때 부른다. 빠진 방의 저장본을 지우고, 위쪽 방의 최근 글을 받아 둔다.
 * 단톡방은 머리줄에 참여자 수가 보여 참여자도 함께 받는다.
 */
export async function syncSnapshots(userId: string, ordered: RoomListItem[]) {
  const listed = new Set(ordered.map((r) => r.key))
  const saved = (await listCacheKeys(userId, PREFIX)).map((k) => k.slice(PREFIX.length))
  for (const key of roomsToForget(saved, listed)) {
    const snapshot = await readSnapshot(userId, key)
    if (snapshot?.membersOnly) dropSnapshot(userId, key)
  }

  const heads = ordered.filter(isFastRoom).slice(0, PREFETCH_ROOMS)
  await Promise.all(heads.map((r) => readSnapshot(userId, r.key)))
  const queue = roomsToPrefetch(heads, (key) => {
    const messages = peekSnapshot<{ createdAt: string }>(userId, key)?.messages
    return messages?.at(-1)?.createdAt
  }).filter((r) => !inflight.has(memKey(userId, r.key)))
  for (const r of queue) inflight.add(memKey(userId, r.key))

  const worker = async () => {
    for (let room = queue.shift(); room; room = queue.shift()) {
      const res = await fetch(apiUrl(`/api/chat/messages?roomId=${encodeURIComponent(room.id)}`)).catch(() => null)
      if (res?.status === 403 || res?.status === 404) dropSnapshot(userId, room.key)
      else if (res?.ok) {
        writeSnapshot(userId, room.key, { messages: (await res.json()) as unknown[], checkedAt: serverTimeOf(res), membersOnly: room.kind !== "COMPANY" })
        if (room.kind === "GROUP") {
          const view = await fetch(apiUrl(`/api/chat/people-rooms/${encodeURIComponent(room.id)}`)).catch(() => null)
          if (view?.ok) await writeSnapshotPeople(userId, room.key, (await view.json()) as PeopleRoomView)
        }
      }
      inflight.delete(memKey(userId, room.key))
    }
  }
  await Promise.all(Array.from({ length: PREFETCH_CONCURRENCY }, worker))
}
