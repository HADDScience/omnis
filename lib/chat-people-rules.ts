// 사람끼리 대화(5단계) — 순수 규칙만. prisma 없음 — 단위 시험과 화면이 같이 쓴다.
// 서버: lib/chat-people.ts · 결정: mydocs/working/2026-10-29-omnis-agent.md 「5단계」
//
// 고른 사람이 1명이면 1:1(DM), 2명 이상이면 단톡방(GROUP).
// 1:1 을 GROUP + 참여자 2명으로 두지 않은 이유: 셋이던 단톡방에서 한 명이 나가면 참여자 2명의 GROUP 이 되는데,
// 그 방을 「두 사람의 1:1」 로 잘못 열면 안 된다. 1:1 은 초대 · 나가기도 없다 — 종류로 가르는 편이 분기가 적다.

/** 같은 두 사람의 1:1 방 열쇠 — 순서와 상관없이 같다. ChatRoom.dmKey(unique)에 들어간다 */
export function dmKeyOf(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

/** 단톡방 이름 최대 길이 */
export const PEOPLE_ROOM_NAME_MAX = 40
/** 한 번에 고르는 사람 수 상한(나 빼고) */
export const PEOPLE_PICK_MAX = 30

/** 단톡방 기본 이름 — 참여자 이름을 잇는다(나는 맨 뒤). 길면 「외 N명」 */
export function defaultGroupName(otherNames: string[], myName: string): string {
  const names = [...otherNames, myName].filter(Boolean)
  let out = ""
  for (let i = 0; i < names.length; i++) {
    const next = out ? `${out}, ${names[i]}` : names[i]
    const rest = names.length - i - 1
    // 다음 이름을 붙였을 때 「외 N명」 자리까지 넘치면 거기서 멈춘다
    if (next.length + (rest > 0 ? ` 외 ${rest}명`.length : 0) > PEOPLE_ROOM_NAME_MAX && out) {
      return `${out} 외 ${names.length - i}명`
    }
    out = next
  }
  return out
}

export type PeopleRoomPlan =
  | { kind: "DM"; otherId: string }
  | { kind: "GROUP"; memberIds: string[] }
  | { error: string }

/**
 * 고른 사람으로 어떤 방을 만들지. 나 자신 · 중복은 뺀다.
 * activeIds: 지금 로그인할 수 있는 구성원(시스템 계정 · 퇴사자 제외). 거기 없는 id 가 하나라도 있으면 거절
 */
export function planPeopleRoom(me: string, picked: string[], activeIds: ReadonlySet<string>): PeopleRoomPlan {
  const others = [...new Set(picked)].filter((id) => id !== me)
  if (others.length === 0) return { error: "대화할 사람을 한 명 이상 골라 주세요" }
  if (others.length > PEOPLE_PICK_MAX) return { error: `한 번에 ${PEOPLE_PICK_MAX}명까지 고를 수 있어요` }
  if (others.some((id) => !activeIds.has(id))) return { error: "고를 수 없는 사람이 들어 있습니다" }
  if (others.length === 1) return { kind: "DM", otherId: others[0] }
  return { kind: "GROUP", memberIds: [me, ...others] }
}

/** 목록 · 머리에 보일 방 이름. 1:1 은 저장한 이름 대신 상대 이름이다(보는 사람마다 다르다) */
export function peopleRoomTitle(
  room: { kind: string; name: string },
  members: { id: string; name: string }[],
  me: string,
): string {
  if (room.kind === "DM") return members.find((m) => m.id !== me)?.name ?? (room.name || "1:1 대화")
  return room.name
}

/**
 * 글에서 알림을 보낼 사람 — `@이름` 이 **그 방 참여자**일 때만. 나 자신은 빼고, 이름이 겹치면 긴 이름부터 맞춘다
 * (「@김철수」 를 「김철」 로 잘못 잡지 않게). 방 밖 사람은 이름이 맞아도 받지 않는다 — 방 내용이 알림으로 새지 않게
 */
export function mentionedMembers(content: string, members: { id: string; name: string }[], me: string): string[] {
  const found = new Set<string>()
  const sorted = [...members].filter((m) => m.id !== me && m.name).sort((a, b) => b.name.length - a.name.length)
  for (const match of content.matchAll(/@([^\s@#]+)/g)) {
    const token = match[1]
    const hit = sorted.find((m) => token.startsWith(m.name))
    if (hit) found.add(hit.id)
  }
  return [...found]
}
