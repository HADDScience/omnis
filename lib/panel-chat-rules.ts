// PC 오른쪽 패널의 채팅 — 폰 채팅 탭(방 목록 → 방 → 대화)을 패널 안에 그대로 둔다. 순수 규칙만(브라우저 · 서버 공용).
// 화면: components/layout/panel-messenger.tsx · right-panel.tsx · floating-nav.tsx
// 계획: mydocs/plans/2026-11-11-side-panel-chat.md

import type { RoomKind } from "./chat-list"

/** 패널이 기억하는 방 — 목록 줄(RoomListItem)에서 방을 다시 그리는 데 드는 칸만 */
export interface PanelRoomRef {
  id: string
  key: string
  kind: RoomKind
  name: string
  muted?: boolean
}

const KINDS: readonly RoomKind[] = ["COMPANY", "TASK", "OMNIS_DM", "GROUP", "DM"]
const ID = /^[A-Za-z0-9_-]{1,64}$/

/** 방 화면 주소 — 업무방은 /chat/task/<업무 id>, 나머지는 /chat/<방 id> */
export function roomHref(room: { kind: RoomKind; id: string }): string {
  return room.kind === "TASK" ? `/chat/task/${room.id}` : `/chat/${room.id}`
}

/** 기기 저장 키 — 사람마다 따로(같은 브라우저를 둘이 쓰면 남의 방을 열지 않게) */
export const panelRoomStorageKey = (userId: string) => `omnis.panel.room.${userId}`

/** 저장해 둔 방을 읽는다. 모양이 틀리면 없는 것으로 — 옛 값 · 손댄 값이 남의 주소를 만들지 않게 id · 키를 다시 맞춘다 */
export function parsePanelRoom(raw: string | null | undefined): PanelRoomRef | null {
  if (!raw) return null
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return null
  }
  if (!v || typeof v !== "object") return null
  const r = v as Record<string, unknown>
  if (typeof r.id !== "string" || !ID.test(r.id)) return null
  if (typeof r.kind !== "string" || !KINDS.includes(r.kind as RoomKind)) return null
  const kind = r.kind as RoomKind
  const key = kind === "TASK" ? `task:${r.id}` : `room:${r.id}`
  if (r.key !== key) return null
  const name = typeof r.name === "string" ? r.name.slice(0, 200) : ""
  return { id: r.id, key, kind, name, ...(typeof r.muted === "boolean" ? { muted: r.muted } : {}) }
}

export function serializePanelRoom(room: PanelRoomRef): string {
  const { id, key, kind, name, muted } = room
  return JSON.stringify({ id, key, kind, name, ...(muted === undefined ? {} : { muted }) })
}

export const isChatPath = (pathname: string | null | undefined) => !!pathname && (pathname === "/chat" || pathname.startsWith("/chat/"))

/**
 * nav 「채팅」 탭이 갈 곳 — 패널을 열어 둔 채 누르면 패널에서 마지막으로 보던 방을 본문에 연다(패널은 닫힌다).
 * 패널이 닫혀 있으면 지금처럼 목록
 */
export function chatTabHref(panelOpen: boolean, last: PanelRoomRef | null): string {
  return panelOpen && last ? roomHref(last) : "/chat"
}

/** 채팅 화면으로 들어온 순간 패널을 닫는다 — 본문이 이미 메신저라 패널은 같은 것을 한 번 더 보여 줄 뿐이다 */
export function closesPanelOn(prev: string | null, next: string): boolean {
  return isChatPath(next) && !isChatPath(prev)
}
