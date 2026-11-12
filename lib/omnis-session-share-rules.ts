// 옴니스 세션 수동 공유 · 인계 — 순수 규칙(prisma 없음). 서버 쪽은 lib/omnis-session-share.ts.
// 계획: mydocs/plans/2026-11-11-session-share.md (#190 @옴니스 세션 공유의 확장)
//
// 권한은 새로 만들지 않는다 — 세션(OMNIS_DM 방)의 참여자 행이 곧 볼 수 있는 사람이다.
// 행마다 들어온 길(shareKind)을 남겨, 방 동기화가 사람 공유 행을 지우지 않게 한다.
//   null    세션 주인(createdById). 만든 사람이거나 인계받은 사람
//   PERSON  주인이 사람을 골라 공유
//   ROOM    방에 공유(originRoomId) — 그 방 참여자와 같게 맞춘다

export type ShareKind = "PERSON" | "ROOM"

export interface SessionMemberRow {
  userId: string
  shareKind: ShareKind | null
}

/** 사람 공유 — 새로 넣을 사람과, 방 공유로 이미 들어와 있어 사람 공유로 바꿀 사람. 주인 · 이미 사람 공유인 사람은 건너뛴다 */
export function planPersonShare(members: readonly SessionMemberRow[], ownerId: string, wanted: readonly string[]) {
  const byId = new Map(members.map((m) => [m.userId, m]))
  const add: string[] = []
  const upgrade: string[] = []
  for (const id of new Set(wanted)) {
    if (!id || id === ownerId) continue
    const row = byId.get(id)
    if (!row) add.push(id)
    else if (row.shareKind === "ROOM") upgrade.push(id)
  }
  return { add, upgrade }
}

/**
 * 방 공유 동기화 — 방 참여자(roomMemberIds)와 같게. ROOM 행만 넣고 뺀다.
 * 주인 · 사람 공유 행은 방을 나가도 남는다(주인이 따로 골라 준 사람이다).
 */
export function planRoomSync(members: readonly SessionMemberRow[], roomMemberIds: readonly string[]) {
  const inRoom = new Set(roomMemberIds)
  const present = new Set(members.map((m) => m.userId))
  return {
    remove: members.filter((m) => m.shareKind === "ROOM" && !inRoom.has(m.userId)).map((m) => m.userId),
    add: [...inRoom].filter((id) => !present.has(id)),
  }
}

/** 공유 해제 — 지울 참여자 행. 주인은 지우지 않는다 */
export function planUnshare(
  members: readonly SessionMemberRow[],
  target: { userId: string } | { room: true } | { all: true },
): string[] {
  if ("all" in target) return members.filter((m) => m.shareKind !== null).map((m) => m.userId)
  if ("room" in target) return members.filter((m) => m.shareKind === "ROOM").map((m) => m.userId)
  return members.filter((m) => m.userId === target.userId && m.shareKind === "PERSON").map((m) => m.userId)
}

/** 인계할 수 있는가 — 주인만, 다른 사람에게, 시스템 계정 아님 */
export function handoverRefusal(input: { actorId: string; ownerId: string | null; toId: string; systemUserId: string }): string | null {
  if (input.actorId !== input.ownerId) return "대화를 연 사람만 넘길 수 있습니다"
  if (!input.toId || input.toId === input.actorId) return "넘겨받을 다른 사람을 골라 주세요"
  if (input.toId === input.systemUserId) return "시스템 계정에는 넘길 수 없습니다"
  return null
}

/** 목록 · 머리줄의 공유 표시 — 방 공유면 방 이름, 사람 공유로 받았으면 「주인님」. 내 세션이고 방 공유가 아니면 null */
export function sharedLabel(input: { viewerId: string; ownerId: string | null; ownerName: string | null; originTitle: string | null }): string | null {
  if (input.originTitle) return input.originTitle
  if (input.ownerId && input.viewerId !== input.ownerId) return `${input.ownerName ?? "다른 분"}님`
  return null
}

/**
 * 방에 남기는 공유 안내. 옴니스 시스템 글의 표식 🤖 를 앞에 둔다 — 검색 제외 · 사건 줄 판별이 이 표식을 본다.
 * 화면은 표식을 떼고 옴니스 아이콘으로 그린다(lib/robot-mark.ts · components/chat/robot-text.tsx, #195)
 */
export function shareNoticeText(sharerName: string): string {
  return `🤖 ${sharerName}님이 옴니스 대화를 공유했어요`
}

/** 받은 사람에게 가는 알림 */
export function shareNotification(input: { sharerName: string; sessionName: string; handover?: boolean }) {
  return {
    title: input.handover ? `${input.sharerName}님이 옴니스 대화를 넘겼어요` : `${input.sharerName}님이 옴니스 대화를 공유했어요`,
    content: input.sessionName,
  }
}
