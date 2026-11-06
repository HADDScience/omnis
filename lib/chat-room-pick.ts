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
