// 방 글 낱말 검색 — MCP search_knowledge 가 의미 검색(색인) 결과에 「내가 든 방」 글을 섞는 규칙.
// prisma 없음 — 단위 시험(chat-room-search.test.ts)이 그대로 읽는다. DB 쪽은 lib/chat-feed.ts searchRoomMessages.
//
// 단톡방 · 1:1 · 옴니스 1:1 글은 임베딩 색인에 넣지 않는다(참여자 전용이라). 그래서 색인을 늘리지 않고
// 부를 때마다 그 사람이 지금 참여자인 방만 골라 본문을 낱말로 찾는다. 권한은 readableRooms(#177)가 정한다.

/** 방 글 검색에 들어가는 방 종류. 전사방은 이미 임베딩 색인(CHAT_MESSAGE)으로 찾는다 */
export const SEARCHABLE_ROOM_KINDS = ["GROUP", "DM", "OMNIS_DM"] as const

/**
 * 검색할 방 — 넘겨받는 방은 readableRooms(지금 참여자인 방 + 전사방)이어야 한다. 여기서 전사방을 뺀다.
 * 참여자 판단을 여기서 다시 하지 않는다: 방 목록을 만든 쪽(#177 readableRooms)이 정본이다.
 */
export function searchableRooms<R extends { kind: string }>(readable: R[]): R[] {
  return readable.filter((r) => (SEARCHABLE_ROOM_KINDS as readonly string[]).includes(r.kind))
}

/** 쿼리가 돌려준 글 중 검색할 방 목록에 든 방의 글만 — 쿼리 조건과 겹치는 두 번째 울타리 */
export function keepPermitted<H extends { roomId: string }>(hits: H[], rooms: { id: string }[]): H[] {
  const allowed = new Set(rooms.map((r) => r.id))
  return hits.filter((h) => allowed.has(h.roomId))
}

/** 낱말 상한 — 긴 질문이 쿼리를 키우지 않게 */
const MAX_WORDS = 6
/** 한 글자 낱말은 거의 모든 글에 걸린다 */
const MIN_WORD = 2

/** 질의를 낱말로 — 공백 · 문장부호로 자르고, 2자 미만 · 중복을 뺀다. 순서는 질의 순서 */
export function splitWords(query: string): string[] {
  const words = query
    .toLowerCase()
    .split(/[\s.,!?;:'"`()[\]{}<>~·…/\\|=+*&^%$#@-]+/u)
    .map((w) => w.trim())
    .filter((w) => [...w].length >= MIN_WORD)
  return [...new Set(words)].slice(0, MAX_WORDS)
}

/** ILIKE 패턴 안의 와일드카드를 글자로 — ESCAPE '\' 와 함께 쓴다 */
export function escapeLike(word: string): string {
  return word.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/** 방 결과는 limit 의 절반까지 — 의미 검색 결과를 밀어내지 않게 */
export function roomLimit(limit: number): number {
  return Math.max(1, Math.floor(limit / 2))
}

export interface RoomContextLine {
  createdAt: Date
  author: string
  content: string
}

export interface RoomHit {
  messageId: string
  roomId: string
  roomTitle: string
  roomKind: string
  createdAt: Date
  author: string
  content: string
  /** 맞은 낱말 수 — 많을수록 앞 */
  score: number
  before: RoomContextLine[]
  after: RoomContextLine[]
}

/**
 * 의미 검색 결과와 방 결과를 한 줄로 — 의미 검색 1등이 맨 앞, 그 뒤로 번갈아 놓는다.
 * 방 결과는 roomLimit(limit) 까지, 전체는 limit 까지. 한쪽이 모자라면 다른 쪽이 그 자리를 채우되
 * 방 결과의 상한은 넘지 않는다.
 */
export function mergeResults<E, R>(embedded: E[], rooms: R[], limit: number): ({ kind: "embedded"; item: E } | { kind: "room"; item: R })[] {
  const roomTake = Math.min(rooms.length, roomLimit(limit))
  const embTake = Math.min(embedded.length, limit - roomTake)
  const e = embedded.slice(0, embTake)
  const r = rooms.slice(0, Math.min(roomTake, limit - embTake))
  const out: ({ kind: "embedded"; item: E } | { kind: "room"; item: R })[] = []
  for (let i = 0; i < Math.max(e.length, r.length); i++) {
    if (i < e.length) out.push({ kind: "embedded", item: e[i] })
    if (i < r.length) out.push({ kind: "room", item: r[i] })
  }
  return out
}

/** 서울 시각 「2026-11-06 14:03」 */
export function seoulTime(d: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .format(d)
    .replace(",", "")
}

const oneLine = (s: string, max: number) => {
  const flat = s.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

/**
 * 결과 한 덩어리. 머리줄로 출처가 방임을 드러낸다:
 *   [3] 방 · 단톡방 「이름」 · 보낸 사람 · 2026-11-06 14:03
 *     … 앞 대화(최대 2줄)
 *   ▶ 맞은 글
 *     … 뒤 대화(최대 2줄)
 */
export function formatRoomHit(n: number, hit: RoomHit, kindLabel: Record<string, string>): string {
  const head = `[${n}] 방 · ${kindLabel[hit.roomKind] ?? hit.roomKind} 「${hit.roomTitle}」 · ${hit.author} · ${seoulTime(hit.createdAt)}`
  const ctx = (l: RoomContextLine) => `  ${seoulTime(l.createdAt).slice(11)} ${l.author}: ${oneLine(l.content, 200)}`
  return [head, ...hit.before.map(ctx), `▶ ${oneLine(hit.content, 600)}`, ...hit.after.map(ctx)].join("\n")
}
