// 채팅 입력창 임시저장(2026-11-11 작업지시자 「방마다 입력 중이던 글을 저장해 두었다가 되살린다」).
//
// 방(전사방 · 단톡방 · 1:1 · 옴니스 1:1 · 업무 스레드)마다 입력칸의 글만 브라우저 localStorage 에 둔다 — 첨부는 대상이 아니다.
// 키는 사람 · 방 단위 `omnis.chat.draft.<userId>.<방 키>`(방 키는 lib/chat-list.ts 의 room: · task:) — 같은 기기에서 다른 사람 것을 읽지 않는다.
// 비우면(보냄 · 다 지움) 지운다. 7일 넘게 손대지 않은 초안은 읽을 때 · 목록을 그릴 때 지운다(sweepDrafts).
// 저장소를 못 쓰면(사생활 보호 모드 · 꽉 참) 조용히 아무것도 하지 않는다 — 입력칸은 그대로 돈다.
// 같은 탭의 방 목록은 DRAFT_EVENT 로, 다른 탭은 storage 이벤트로 바뀐 것을 안다.

export const DRAFT_PREFIX = "omnis.chat.draft."
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const DRAFT_EVENT = "omnis:chat-draft"
/** 방 목록 미리보기 앞말 */
export const DRAFT_LABEL = "임시저장:"
/** 방 목록 미리보기에 보일 글자 수 — 서버 미리보기(60자)와 맞춘다 */
export const DRAFT_PREVIEW_CHARS = 60
/** 한 방에 저장할 글자 상한 — 붙여 넣은 긴 글이 저장소를 채우지 않게 */
export const DRAFT_MAX_CHARS = 20_000

export interface StoredDraft {
  text: string
  /** 마지막으로 고친 시각(ms) */
  at: number
}

export const draftKey = (userId: string, roomKey: string) => `${DRAFT_PREFIX}${userId}.${roomKey}`

/** 저장된 값을 읽는다 — 모양이 틀리거나 비었거나 오래됐으면 null(지울 대상) */
export function parseDraft(raw: string | null, now: number): StoredDraft | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as unknown
    if (!v || typeof v !== "object") return null
    const { text, at } = v as Record<string, unknown>
    if (typeof text !== "string" || typeof at !== "number" || !Number.isFinite(at)) return null
    if (!text.trim()) return null
    if (now - at > DRAFT_TTL_MS) return null
    return { text, at }
  } catch {
    return null
  }
}

/** 저장할 값 — 공백뿐이면 null(지운다). 줄바꿈 · `@이름` · `#업무` 는 글 그대로 둔다 */
export function serializeDraft(text: string, now: number): string | null {
  if (!text.trim()) return null
  return JSON.stringify({ text: text.slice(0, DRAFT_MAX_CHARS), at: now } satisfies StoredDraft)
}

/** 방 목록 미리보기 — 「임시저장: 」 뒤에 줄바꿈 · 여러 칸을 한 칸으로 줄인 앞부분 */
export function draftPreview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim()
  const cut = flat.length > DRAFT_PREVIEW_CHARS ? `${flat.slice(0, DRAFT_PREVIEW_CHARS)}…` : flat
  return `${DRAFT_LABEL} ${cut}`
}

/** 키에서 방 키를 꺼낸다 — 이 사람 것이 아니면 null */
export function roomKeyOfDraftKey(key: string, userId: string): string | null {
  const head = `${DRAFT_PREFIX}${userId}.`
  return key.startsWith(head) ? key.slice(head.length) : null
}

// ─── 브라우저 저장소 ─────────────────────────────────────────

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}

function notify(roomKey: string) {
  try {
    window.dispatchEvent(new CustomEvent(DRAFT_EVENT, { detail: { roomKey } }))
  } catch {
    // 알리지 못해도 다음에 목록을 그릴 때 읽는다
  }
}

export function readDraft(userId: string, roomKey: string, now = Date.now()): string | null {
  const s = storage()
  if (!s || !userId || !roomKey) return null
  try {
    const key = draftKey(userId, roomKey)
    const raw = s.getItem(key)
    const draft = parseDraft(raw, now)
    if (!draft && raw !== null) s.removeItem(key)
    return draft?.text ?? null
  } catch {
    return null
  }
}

/** 고친 글을 저장한다. 비었으면 지운다. 저장된 글과 같으면 시각을 바꾸지 않는다(되살리기만 해서는 7일이 늘지 않는다) */
export function writeDraft(userId: string, roomKey: string, text: string, now = Date.now()): void {
  const s = storage()
  if (!s || !userId || !roomKey) return
  try {
    const key = draftKey(userId, roomKey)
    const prev = s.getItem(key)
    const next = serializeDraft(text, now)
    if (next === null) {
      if (prev === null) return
      s.removeItem(key)
    } else {
      if (parseDraft(prev, now)?.text === text.slice(0, DRAFT_MAX_CHARS)) return
      s.setItem(key, next)
    }
    notify(roomKey)
  } catch {
    // 저장소가 꽉 찼거나 막혔다 — 임시저장 없이 그대로 쓴다
  }
}

export function clearDraft(userId: string, roomKey: string): void {
  writeDraft(userId, roomKey, "")
}

/** 로그아웃 — 이 기기의 초안을 사람 가리지 않고 모두 지운다(lib/chat-cache.ts clearChatCache) */
export function clearAllDrafts(): void {
  const s = storage()
  if (!s) return
  try {
    const keys: string[] = []
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i)
      if (k?.startsWith(DRAFT_PREFIX)) keys.push(k)
    }
    for (const k of keys) s.removeItem(k)
  } catch {
    // 못 지우면 7일 뒤 정리된다
  }
}

/** 이 사람의 초안 전부(방 키 → 글) — 오래되거나 모양이 틀린 것은 지운다. 다른 사람의 오래된 초안도 같이 지운다 */
export function sweepDrafts(userId: string, now = Date.now()): Map<string, string> {
  const out = new Map<string, string>()
  const s = storage()
  if (!s) return out
  try {
    const keys: string[] = []
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i)
      if (k?.startsWith(DRAFT_PREFIX)) keys.push(k)
    }
    for (const k of keys) {
      const draft = parseDraft(s.getItem(k), now)
      if (!draft) {
        s.removeItem(k)
        continue
      }
      const roomKey = userId ? roomKeyOfDraftKey(k, userId) : null
      if (roomKey) out.set(roomKey, draft.text)
    }
  } catch {
    // 못 읽으면 초안 표시 없이 목록을 그린다
  }
  return out
}
