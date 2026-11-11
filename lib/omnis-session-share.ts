// 옴니스 세션 수동 공유 · 해제 · 인계(2026-11-11). 규칙은 lib/omnis-session-share-rules.ts, 계획은 mydocs/plans/2026-11-11-session-share.md.
//
// 볼 수 있는 사람 = 세션(OMNIS_DM) 참여자 행 — roomAccess · 목록 · 검색 · 첨부 · MCP 가 이미 이 조건을 쓴다(#190).
// 공유는 행을 더하고, 해제는 행을 지우고, 인계는 주인(createdById)을 바꾼다. 쓰기 확인 카드는 지금처럼 그 실행의 요청자만 누른다.
import { prisma } from "@/lib/db"
import { createNotification } from "@/lib/notifications"
import { roomAccess } from "@/lib/chat-rooms"
import { ACTIVE_MEMBER_WHERE } from "@/lib/active-members"
import { SYSTEM_USER_ID } from "@/lib/system-user"
import { peopleRoomTitle } from "@/lib/chat-people-rules"
import { postNotice, syncSessionMembers } from "@/lib/omnis-mention-notice"
import { handoverRefusal, planPersonShare, planUnshare, shareNoticeText, shareNotification, type ShareKind } from "@/lib/omnis-session-share-rules"

export type ShareResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string }
const fail = (status: number, error: string) => ({ ok: false as const, status, error })

/** 알림 종류 — chat_ 로 시작해 채팅 알림 설정을 따르고, 누르면 그 세션을 연다(lib/schemas/notification.ts) */
export const SESSION_SHARED_NOTIFICATION = "chat_omnis_shared"

export interface ShareState {
  isOwner: boolean
  owner: { id: string; name: string } | null
  /** 사람 공유(PERSON)로 받은 사람 */
  people: { id: string; name: string }[]
  /** 방 공유 — 보는 사람 기준 이름. 없으면 null */
  room: { id: string; title: string; kind: string } | null
  /** 지금 볼 수 있는 사람 수(주인 포함) */
  memberCount: number
}

/** 세션 하나 — 내가 참여자일 때만. 아니면 없는 것과 같다(404) */
async function sessionFor(roomId: string, userId: string) {
  const room = await prisma.chatRoom.findFirst({
    where: { id: roomId, kind: "OMNIS_DM", members: { some: { userId } } },
    select: {
      id: true, name: true, createdById: true, originRoomId: true,
      createdBy: { select: { id: true, name: true } },
      members: { select: { userId: true, shareKind: true, user: { select: { id: true, name: true } } } },
    },
  })
  return room
}

export async function shareState(roomId: string, userId: string): Promise<ShareResult<ShareState>> {
  const s = await sessionFor(roomId, userId)
  if (!s) return fail(404, "대화를 찾을 수 없습니다")
  let room: ShareState["room"] = null
  if (s.originRoomId) {
    const r = await prisma.chatRoom.findUnique({
      where: { id: s.originRoomId },
      select: { id: true, kind: true, name: true, dmKey: true, members: { select: { user: { select: { id: true, name: true } } } } },
    })
    if (r) room = { id: r.id, kind: r.kind, title: r.kind === "COMPANY" ? r.name : peopleRoomTitle(r, r.members.map((m) => m.user), userId) }
  }
  return {
    ok: true,
    value: {
      isOwner: s.createdById === userId,
      owner: s.createdBy,
      people: s.members.filter((m) => m.shareKind === "PERSON").map((m) => m.user),
      room,
      memberCount: s.members.length,
    },
  }
}

/** 주인만 — 아니면 403(참여자는 세션이 있다는 것을 이미 안다) */
async function ownedSession(roomId: string, userId: string) {
  const s = await sessionFor(roomId, userId)
  if (!s) return fail(404, "대화를 찾을 수 없습니다")
  if (s.createdById !== userId) return fail(403, "대화를 연 사람만 공유 · 해제 · 인계할 수 있습니다")
  return { ok: true as const, session: s }
}

async function notifyShared(userIds: string[], sharerId: string, session: { id: string; name: string }, handover = false) {
  if (userIds.length === 0) return
  const sharer = await prisma.user.findUnique({ where: { id: sharerId }, select: { name: true } })
  const n = shareNotification({ sharerName: sharer?.name ?? "누군가", sessionName: session.name, handover })
  await Promise.all(
    userIds.map((uid) =>
      createNotification(uid, SESSION_SHARED_NOTIFICATION, n.title, n.content, session.id).catch((e) => console.error("[session-share] 알림 실패", e)),
    ),
  )
}

/** 사람에게 공유 — 재직 구성원만. 새로 받은 사람에게 알림 1건 */
export async function shareWithPeople(roomId: string, ownerId: string, userIds: string[]): Promise<ShareResult<{ added: number }>> {
  const owned = await ownedSession(roomId, ownerId)
  if (!owned.ok) return owned
  const { session } = owned
  const plan = planPersonShare(session.members as { userId: string; shareKind: ShareKind | null }[], ownerId, userIds.filter((id) => id !== SYSTEM_USER_ID))
  if (plan.add.length) {
    const found = await prisma.user.count({ where: { id: { in: plan.add }, ...ACTIVE_MEMBER_WHERE } })
    if (found !== plan.add.length) return fail(400, "고를 수 없는 사람이 들어 있습니다")
  }
  await prisma.$transaction([
    prisma.chatRoomMember.createMany({ data: plan.add.map((userId) => ({ roomId, userId, shareKind: "PERSON" as const })), skipDuplicates: true }),
    prisma.chatRoomMember.updateMany({ where: { roomId, userId: { in: plan.upgrade } }, data: { shareKind: "PERSON" } }),
  ])
  await notifyShared(plan.add, ownerId, session)
  return { ok: true, value: { added: plan.add.length } }
}

/**
 * 방에 공유 — 단톡방 · 1:1 · 전사방. 주인이 들어 있는 방만. 세션의 방 공유는 하나 — 다른 방에 공유돼 있었으면 그 방 사람은 빠진다.
 * 방에는 「○○님이 옴니스 대화를 공유했어요 · 열기」 한 줄, 새로 볼 수 있게 된 사람에게 알림 1건
 */
export async function shareWithRoom(roomId: string, ownerId: string, targetRoomId: string): Promise<ShareResult<{ added: number }>> {
  const owned = await ownedSession(roomId, ownerId)
  if (!owned.ok) return owned
  const { session } = owned
  const target = await prisma.chatRoom.findUnique({ where: { id: targetRoomId }, select: { id: true, kind: true } })
  if (!target || (await roomAccess(targetRoomId, ownerId)) !== "ok") return fail(404, "방을 찾을 수 없습니다")
  if (!["GROUP", "DM", "COMPANY"].includes(target.kind)) return fail(400, "단톡방 · 1:1 · 전사방에만 공유할 수 있습니다")
  if (session.originRoomId !== targetRoomId) {
    await prisma.$transaction([
      prisma.chatRoomMember.deleteMany({ where: { roomId, shareKind: "ROOM" } }),
      prisma.chatRoom.update({ where: { id: roomId }, data: { originRoomId: targetRoomId } }),
    ])
  }
  const added = await syncSessionMembers(targetRoomId, roomId)
  const sharer = await prisma.user.findUnique({ where: { id: ownerId }, select: { name: true } })
  await postNotice(targetRoomId, shareNoticeText(sharer?.name ?? "누군가"), roomId)
  await notifyShared(added.filter((id) => id !== ownerId), ownerId, session)
  return { ok: true, value: { added: added.length } }
}

/** 공유 해제 — 주인만. 한 사람(사람 공유) · 방 공유 · 모두. 빠진 사람에게는 그 순간부터 404 */
export async function unshare(
  roomId: string,
  ownerId: string,
  target: { userId: string } | { room: true } | { all: true },
): Promise<ShareResult<{ removed: number }>> {
  const owned = await ownedSession(roomId, ownerId)
  if (!owned.ok) return owned
  const { session } = owned
  const ids = planUnshare(session.members as { userId: string; shareKind: ShareKind | null }[], target)
  const dropRoom = "room" in target || "all" in target
  await prisma.$transaction([
    prisma.chatRoomMember.deleteMany({ where: { roomId, userId: { in: ids }, shareKind: { not: null } } }),
    ...(dropRoom && session.originRoomId ? [prisma.chatRoom.update({ where: { id: roomId }, data: { originRoomId: null } })] : []),
  ])
  return { ok: true, value: { removed: ids.length } }
}

/**
 * 인계 — 주인을 다른 재직 구성원으로. 넘겨받는 사람은 주인 행(shareKind null)이 되고, 이전 주인은 사람 공유로 남는다.
 * 실행 · 비용 · 확인 카드는 실행마다 요청자의 것이라 그대로다. 넘겨받은 사람에게 알림 1건
 */
export async function handover(roomId: string, ownerId: string, toId: string): Promise<ShareResult<{ ownerId: string }>> {
  const s = await sessionFor(roomId, ownerId)
  if (!s) return fail(404, "대화를 찾을 수 없습니다")
  const refused = handoverRefusal({ actorId: ownerId, ownerId: s.createdById, toId, systemUserId: SYSTEM_USER_ID })
  if (refused) return fail(s.createdById === ownerId ? 400 : 403, refused)
  const found = await prisma.user.count({ where: { id: toId, ...ACTIVE_MEMBER_WHERE } })
  if (found === 0) return fail(400, "없거나 재직 중이 아닌 사람입니다")
  await prisma.$transaction([
    prisma.chatRoom.update({ where: { id: roomId }, data: { createdById: toId } }),
    prisma.chatRoomMember.upsert({
      where: { roomId_userId: { roomId, userId: toId } },
      create: { roomId, userId: toId, shareKind: null },
      update: { shareKind: null },
    }),
    prisma.chatRoomMember.update({ where: { roomId_userId: { roomId, userId: ownerId } }, data: { shareKind: "PERSON" } }),
  ])
  await notifyShared([toId], ownerId, s, true)
  return { ok: true, value: { ownerId: toId } }
}
