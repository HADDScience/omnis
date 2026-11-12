// 방 고르기 — MCP list_chat(view=room) 이 방 이름 · ID 나 참여자 이름으로 방 하나를 찾는 규칙. prisma 없음 — 단위 시험이 같이 쓴다.
// 넘겨받는 방은 이미 「이 사람이 읽을 수 있는 방」 이다(lib/chat-feed.ts readableRooms). 여기서는 고르기만 한다.

export interface PickableRoom {
  id: string
  kind: string
  /** 보는 사람 기준 이름 — 1:1 은 상대 이름(peopleRoomTitle) */
  title: string
  /** 참여자. 전사방은 비어 있다(참여자 행이 없다) */
  members: { id: string; name: string }[]
  lastAt: Date
}

/** 이름 끝의 호칭을 뗀다 — findUsers(lib/omnis-mcp.ts)와 같은 목록 */
export function bareName(raw: string): string {
  return raw.trim().replace(/(님|씨|박사님|대표님|과장님|상무님)$/g, "")
}

const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase()

/** 방 이름 일부 · ID 로. ID 가 정확히 맞으면 그 방 하나, 아니면 이름(공백 무시)에 들어 있는 방 전부 — 최근 글 순 */
export function pickByRef(rooms: PickableRoom[], ref: string): PickableRoom[] {
  const q = ref.trim()
  if (!q) return []
  const byId = rooms.find((r) => r.id === q)
  if (byId) return [byId]
  const n = norm(q)
  return rooms.filter((r) => norm(r.title).includes(n)).sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime())
}

/**
 * 참여자 이름으로 — 정확히 그 구성(나는 넣지 않아도 들어간다)인 방. 전사방은 참여자가 없어 걸리지 않는다.
 * 이름은 방 참여자 이름과 맞춘다(퇴사자도 방에는 남는다): 같은 이름 → 호칭 뗀 이름 → 두 글자 이상 일부.
 * 이름 하나가 참여자 둘에 걸리면(일부가 겹치면) 그 방은 고르지 않는다 — 다른 사람 방을 잘못 열지 않게.
 */
export function pickByMembers(rooms: PickableRoom[], names: string[], me: string): PickableRoom[] {
  const wanted = [...new Set(names.map(bareName).filter(Boolean))]
  if (wanted.length === 0) return []
  const hits: PickableRoom[] = []
  for (const room of rooms) {
    if (room.members.length === 0) continue
    const others = room.members.filter((m) => m.id !== me)
    if (!room.members.some((m) => m.id === me)) continue
    const matched = new Set<string>()
    let ok = true
    for (const w of wanted) {
      const exact = room.members.filter((m) => m.name === w)
      const found = exact.length ? exact : w.length >= 2 ? room.members.filter((m) => m.name.includes(w)) : []
      if (found.length !== 1) { ok = false; break }
      matched.add(found[0].id)
    }
    if (!ok) continue
    matched.delete(me)
    // 나를 뺀 참여자가 고른 사람과 꼭 같아야 한다. 「나와의 대화」 는 나만 고르면 걸린다
    if (matched.size === others.length && others.every((m) => matched.has(m.id))) hits.push(room)
  }
  return hits.sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime())
}

// ─── 글 보내기 대상(MCP post_message 의 room) ─────────────────────────────

/** 「나와의 대화」 를 가리키는 말 — 공백 · 대소문자 무시 */
const SELF_ALIASES = new Set(["me", "self", "나", "내방", "나와의대화", "나에게", "메모"].map(norm))

export function isSelfAlias(ref: string): boolean {
  return SELF_ALIASES.has(norm(ref))
}

/** 전사방을 가리키는 말 — 이름 일부로도 걸리지만, 비워 두거나 이렇게 써도 전사방이다 */
const COMPANY_ALIASES = new Set(["전사방", "전체", "회사", "company", "default-room"].map(norm))

export type PostTarget =
  | { kind: "company" }
  /** room 이 없으면 아직 「나와의 대화」 를 연 적이 없다 — 부르는 쪽이 연다 */
  | { kind: "self"; room: PickableRoom | null }
  | { kind: "room"; room: PickableRoom }
  | { kind: "omnis"; room: PickableRoom }
  | { kind: "many"; rooms: PickableRoom[] }
  | { kind: "none" }

/** 「나와의 대화」 — 참여자가 나 하나뿐인 1:1 */
export function selfRoomOf(rooms: PickableRoom[], me: string): PickableRoom | null {
  return rooms.find((r) => r.kind === "DM" && r.members.length === 1 && r.members[0].id === me) ?? null
}

/**
 * 글을 보낼 방 하나를 고른다. rooms 는 이미 「이 사람이 읽을 수 있는 방」(readableRooms)이라 남의 방은 걸리지 않는다.
 * 비우면 전사방, 「나와의 대화」 별칭이면 그 방, 아니면 pickByRef(ID 정확히 · 이름 일부). 여러 방에 맞으면 고르지 않는다.
 */
export function pickPostTarget(rooms: PickableRoom[], ref: string | null | undefined, me: string): PostTarget {
  const q = (ref ?? "").trim()
  if (!q || COMPANY_ALIASES.has(norm(q))) return { kind: "company" }
  if (isSelfAlias(q)) return { kind: "self", room: selfRoomOf(rooms, me) }
  const hits = pickByRef(rooms, q)
  if (hits.length === 0) return { kind: "none" }
  if (hits.length > 1) return { kind: "many", rooms: hits }
  const room = hits[0]
  if (room.kind === "COMPANY") return { kind: "company" }
  if (room.kind === "OMNIS_DM") return { kind: "omnis", room }
  if (room.kind === "DM" && room.members.length === 1 && room.members[0].id === me) return { kind: "self", room }
  return { kind: "room", room }
}
