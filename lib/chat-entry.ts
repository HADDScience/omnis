// 방을 누르는 순간부터 글을 쓸 수 있게(2026-10-30 작업지시자 「채팅을 누르면 바로 메시지를 작성할 수 있어야 한다」).
//
// 방 화면은 서버가 그린다 — 글 · 확인 카드 · 돌던 실행까지 받아야 화면이 온다. 그 사이 loading 화면
// (components/messenger/cached-room-preview.tsx)이 진짜 입력창을 먼저 그리고, 거기 쓴 글을 여기 맡겨 둔다.
// 방 화면의 입력창은 처음 그릴 때 한 번 꺼내 간다(hooks/use-composer-handoff.ts). 보내기를 눌러 둔 글(queued)은 방 화면이 보낸다.
//
// 브라우저 메모리에만 둔다 — 새로고침하면 사라져도 되는 몇 초짜리 값이다. 방 키는 lib/chat-list.ts 의 room: · task:.

import type { RoomList, RoomListItem } from "@/lib/chat-rooms"

export interface ComposerHandoff {
  /** 입력칸에 남은 글 */
  text: string
  /** 커서 자리 */
  caret: number
  /** loading 입력창에 포커스가 있었는가 — 있었으면 방 화면 입력창으로 옮긴다 */
  focused: boolean
  /** 보내기를 눌러 둔 글. 방 화면이 받자마자 보낸다 */
  queued: string | null
  /** 보내기를 누른 시각(ms) — 오래된 것은 보내지 않고 입력칸에 되돌린다(queuedIsFresh) */
  queuedAt: number
}

/**
 * 보내기를 눌러 둔 글을 지금 보내도 되는가. 방이 늦게 열리거나 그 사이 다른 방으로 옮겼다가 한참 뒤 돌아오면
 * 누른 지 오래다 — 그때는 보내지 않고 입력칸에 남긴다(모르는 사이 글이 나가지 않게)
 */
export const QUEUED_FRESH_MS = 30_000
export function queuedIsFresh(h: Pick<ComposerHandoff, "queued" | "queuedAt">, now: number): boolean {
  return h.queued !== null && now - h.queuedAt <= QUEUED_FRESH_MS
}

const handoffs = new Map<string, ComposerHandoff>()

/**
 * 방 화면이 받을 것 — 보낼 글과 입력칸에 둘 글. 오래된 보내기 대기 글은 보내지 않고 입력칸 앞에 되돌린다
 */
export function resolveHandoff(h: ComposerHandoff, now: number): { send: string | null; text: string } {
  if (h.queued === null) return { send: null, text: h.text }
  if (queuedIsFresh(h, now)) return { send: h.queued, text: h.text }
  return { send: null, text: h.text ? `${h.queued}\n${h.text}` : h.queued }
}

export function writeHandoff(key: string, patch: Partial<ComposerHandoff>) {
  const prev = handoffs.get(key) ?? { text: "", caret: 0, focused: false, queued: null, queuedAt: 0 }
  handoffs.set(key, { ...prev, ...patch })
}

export function peekHandoff(key: string): ComposerHandoff | null {
  return handoffs.get(key) ?? null
}

/** 꺼내면 지운다 — 한 번만 넘긴다(개발 모드의 effect 두 번 실행에도 두 번 보내지 않는다) */
export function takeHandoff(key: string): ComposerHandoff | null {
  const h = handoffs.get(key) ?? null
  handoffs.delete(key)
  return h
}

// ─── 방 머리 ───────────────────────────────────────────────
//
// loading 화면이 방 이름을 바로 그리게 — 목록이 마지막으로 받은 것을 메모리에 둔다. 없으면 기기 저장(chat-cache)을 본다.

let lastList: RoomList | null = null

export function rememberRoomList(list: RoomList) {
  lastList = list
}

export function roomFromList(list: RoomList | null, key: string): RoomListItem | null {
  if (!list) return null
  for (const rows of [list.omnis, list.company, list.tasks, list.groups]) {
    const hit = rows.find((r) => r.key === key)
    if (hit) return hit
  }
  return null
}

export function rememberedRoom(key: string): RoomListItem | null {
  return roomFromList(lastList, key)
}
