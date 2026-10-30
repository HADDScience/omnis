/**
 * 채팅 목록 커서 — `(createdAt, id)` 쌍.
 *
 * 예전 커서는 시각 하나였다. 그러면 두 가지로 글이 빠진다.
 *
 * 1. **같은 시각의 글이 페이지 경계에 걸린다.** 카톡 이식분은 초 단위라 같은 시각이 흔하다.
 *    `createdAt < t` 로 이전 페이지를 넘기면 경계 시각 t 의 나머지 글이 영영 안 보인다
 * 2. **늦게 커밋된 글.** `createdAt` 은 DB 가 트랜잭션 시작 시각으로 찍는다. 먼저 시작해 늦게 커밋된 글은
 *    이미 지나간 커서보다 시각이 앞서 `createdAt > 커서` 폴링에 다시 걸리지 않는다
 *
 * 1 은 id 로 순서를 끝까지 정해 막고, 2 는 폴링이 커서보다 조금 앞부터 겹쳐 읽고 id 로 중복을 걸러 막는다.
 */

/** 폴링이 커서보다 이만큼 앞부터 다시 읽는다 — 글 저장 트랜잭션은 1초 안에 끝난다. 넉넉히 둔다 */
export const POLL_OVERLAP_MS = 10_000

export type Cursor = { createdAt: Date; id: string | null }

const SEP = "|"

/** 화면이 보낼 커서 문자열. `시각|id` */
export function encodeCursor(m: { createdAt: string | Date; id: string }): string {
  const iso = typeof m.createdAt === "string" ? m.createdAt : m.createdAt.toISOString()
  return `${iso}${SEP}${m.id}`
}

/**
 * 커서 문자열을 읽는다. 시각만 온 옛 화면(설치된 앱이 캐시한 번들)도 받는다 — 그때 id 는 null.
 * 시각이 아니면 null.
 */
export function parseCursor(raw: string | null): Cursor | null {
  if (!raw) return null
  const at = raw.indexOf(SEP)
  const iso = at === -1 ? raw : raw.slice(0, at)
  const id = at === -1 ? null : raw.slice(at + 1) || null
  const createdAt = new Date(iso)
  if (Number.isNaN(createdAt.getTime())) return null
  return { createdAt, id }
}

/** 커서보다 앞(오래된) 글 — 이전 페이지. id 가 없으면 예전처럼 시각만 본다 */
export function olderThan(c: Cursor) {
  if (!c.id) return { createdAt: { lt: c.createdAt } }
  return { OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: c.id } }] }
}

/**
 * 커서보다 뒤(새) 글 — 검색 결과 보기에서 아래로 한 페이지씩 넘길 때.
 * 지난 대화를 넘기는 것이라 겹쳐 읽지 않는다 — 겹치면 같은 시각 글이 한 페이지를 넘을 때 제자리를 돈다.
 */
export function newerThan(c: Cursor) {
  if (!c.id) return { createdAt: { gt: c.createdAt } }
  return { OR: [{ createdAt: { gt: c.createdAt } }, { createdAt: c.createdAt, id: { gt: c.id } }] }
}

/**
 * 폴링 — 커서보다 `POLL_OVERLAP_MS` 앞부터. 겹친 글은 화면이 id 로 거른다.
 * 겹쳐 읽는 것이 핵심이라 id 로 경계를 가르지 않는다.
 */
export function pollSince(c: Cursor) {
  return { createdAt: { gt: new Date(c.createdAt.getTime() - POLL_OVERLAP_MS) } }
}

type Ordered = { createdAt: string | Date; id: string }

function time(v: string | Date): number {
  return typeof v === "string" ? new Date(v).getTime() : v.getTime()
}

/** `(createdAt, id)` 순서 비교 — 서버 정렬과 같다 */
export function compareMessages(a: Ordered, b: Ordered): number {
  const d = time(a.createdAt) - time(b.createdAt)
  if (d !== 0) return d
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** 둘 중 뒤의 것. 커서를 앞으로 되돌리지 않기 위해 쓴다 */
export function laterOf<T extends Ordered>(a: T | null, b: T | null): T | null {
  if (!a) return b
  if (!b) return a
  return compareMessages(a, b) >= 0 ? a : b
}

/**
 * 받아 온 글을 목록에 합친다. 이미 있는 id 는 건너뛰고, 새 글은 순서대로 제자리에 넣는다
 * (늦게 커밋된 글이 뒤에 온 글보다 앞에 들어가야 한다).
 * 아직 서버 id 가 없는 글(보내는 중 `temp-…`)은 맨 뒤에 그대로 둔다.
 * 바뀐 것이 없으면 `prev` 를 그대로 돌려준다 — 화면을 다시 그리지 않게.
 */
export function mergeIncoming<T extends Ordered>(prev: T[], incoming: T[], isLocal: (m: T) => boolean): T[] {
  const ids = new Set(prev.map((m) => m.id))
  const fresh = incoming.filter((m) => !ids.has(m.id))
  if (fresh.length === 0) return prev
  const settled = prev.filter((m) => !isLocal(m))
  const local = prev.filter(isLocal)
  return [...settled, ...fresh].sort(compareMessages).concat(local)
}
