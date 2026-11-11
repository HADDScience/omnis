// 채팅 기기 저장(오프라인 캐시) — 방을 열 때 저장해 둔 것으로 바로 그리고 뒤에서 새로 받는다(stale-while-revalidate).
// 2026-10-29 작업지시자 「빠르게 느껴지게」. 브라우저에서만 쓴다.
//
// 저장 범위(회사 데이터가 기기에 남는다 — mydocs/manual/ux-rules.md 「기기 저장」):
//   - 방 목록 한 벌(이름 · 마지막 글 미리보기 60자 · 안 읽은 수 · 폴더)
//   - 방 저장본(lib/room-snapshot.ts, 키 snap:<방 키>): 최근 글 30개. 전사 · 사람 방은 답장 인용 · 첨부 이름 · 경로 · 크기까지, 사람 방은 참여자도.
//     첨부 파일 본문 · 확인 카드 · 도구 기록은 넣지 않는다
//   - 방 MAX_ROOMS 개까지. 넘으면 오래 안 연 방부터 지운다
// 지우는 때: 로그아웃(clearChatCache) · 다른 사람이 이 기기로 로그인했을 때(소유자가 바뀌면 통째로 비운다) ·
// 참여자만 보는 방에서 빠졌을 때(서버가 403 · 404 로 답하거나 목록에서 사라질 때, lib/room-snapshot.ts).
// 사람마다 키를 나눈다(`<userId>:<key>`) — 같은 기기에서 다른 사람 것을 읽지 않는다.
// 입력칸 임시저장(lib/chat-draft.ts, localStorage)도 로그아웃 때 함께 지운다.
// IndexedDB 를 못 쓰면(사생활 보호 모드 등) 조용히 아무것도 하지 않는다 — 화면은 서버만으로 그대로 돈다.

import { clearAllDrafts } from "./chat-draft"

const DB_NAME = "omnis-chat-cache"
const STORE = "kv"
const OWNER_KEY = "omnis.chat-cache.owner"
const MAX_ROOMS = 40

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null)
  dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => {
        resolve(req.result)
        sweepLegacy(req.result)
      }
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

/** 예전 저장분(<사람>:room:<방 키>)을 지운다 — 저장본이 snap: 하나로 합쳐졌다. 옛 탭이 다시 쓸 수 있어 페이지를 열 때마다 본다 */
function sweepLegacy(db: IDBDatabase) {
  try {
    const store = db.transaction(STORE, "readwrite").objectStore(STORE)
    const keys = store.getAllKeys()
    keys.onsuccess = () => {
      for (const key of keys.result) if (isLegacyKey(String(key))) store.delete(key)
    }
  } catch {
    // 못 지우면 다음에 연 때 지운다
  }
}

export const isLegacyKey = (key: string) => /^[^:]+:room:/.test(key)

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb()
  if (!db) return undefined
  return new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, mode)
      const req = run(t.objectStore(STORE))
      t.oncomplete = () => resolve(req ? (req.result as T) : undefined)
      t.onerror = () => resolve(undefined)
      t.onabort = () => resolve(undefined)
    } catch {
      resolve(undefined)
    }
  })
}

/** 이 기기의 지금 주인. 다른 사람이면 앞 사람의 저장분을 통째로 지운다 */
async function claim(userId: string) {
  let owner: string | null = null
  try {
    owner = window.localStorage.getItem(OWNER_KEY)
    if (owner !== userId) window.localStorage.setItem(OWNER_KEY, userId)
  } catch {
    return
  }
  if (owner && owner !== userId) await tx("readwrite", (s) => s.clear())
}

const k = (userId: string, key: string) => `${userId}:${key}`

export async function readCache<T>(userId: string, key: string): Promise<T | null> {
  if (!userId) return null
  await claim(userId)
  const v = await tx<{ at: number; value: T }>("readonly", (s) => s.get(k(userId, key)))
  return v?.value ?? null
}

export async function writeCache<T>(userId: string, key: string, value: T): Promise<void> {
  if (!userId) return
  await claim(userId)
  await tx("readwrite", (s) => s.put({ at: Date.now(), value }, k(userId, key)))
  if (key.startsWith("snap:")) void trimRooms(userId)
}

/** 방 저장분이 MAX_ROOMS 를 넘으면 오래된 것부터 */
async function trimRooms(userId: string) {
  const prefix = k(userId, "snap:")
  const all = await tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys())
  const rooms = (all ?? []).map(String).filter((key) => key.startsWith(prefix))
  if (rooms.length <= MAX_ROOMS) return
  const stamped = await Promise.all(
    rooms.map(async (key) => ({ key, at: (await tx<{ at: number }>("readonly", (s) => s.get(key)))?.at ?? 0 })),
  )
  stamped.sort((a, b) => a.at - b.at)
  const drop = stamped.slice(0, rooms.length - MAX_ROOMS)
  await tx("readwrite", (s) => {
    for (const d of drop) s.delete(d.key)
  })
}

/** 저장본 하나를 지운다 */
export async function deleteCache(userId: string, key: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(k(userId, key)))
}

/** 이 사람의 저장 키(앞붙이로 거른다). 돌려주는 키에 사람 앞붙이는 없다 */
export async function listCacheKeys(userId: string, prefix: string): Promise<string[]> {
  const all = await tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys())
  const head = k(userId, "")
  return (all ?? []).map(String).filter((key) => key.startsWith(head + prefix)).map((key) => key.slice(head.length))
}

/** 로그아웃 — 이 기기의 채팅 저장분을 모두 지운다 */
export async function clearChatCache(): Promise<void> {
  try {
    window.localStorage.removeItem(OWNER_KEY)
    clearAllDrafts()
  } catch {
    // 저장소를 못 쓰면 지울 것도 없다
  }
  await tx("readwrite", (s) => s.clear())
}

export const LIST_CACHE_KEY = "list"
