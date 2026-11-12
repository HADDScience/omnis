// 옴니스 세션 ↔ 사람 방 — 안내 줄(에이전트 저장 lib/agent/store.ts 가 부른다)과 참여자 맞추기(초대 · 나가기가 부른다).
// lib/omnis-mention.ts 는 에이전트 서비스를 불러 무겁고 순환하므로 가벼운 이쪽에 따로 둔다.
import { prisma } from "@/lib/db"
import { getSystemUserId, SYSTEM_USER_ID } from "@/lib/system-user"
import { ACTIVE_MEMBER_WHERE } from "@/lib/active-members"
import { planRoomSync } from "@/lib/omnis-session-share-rules"
import { closesNotice, sessionNotice, type SessionEnd } from "@/lib/omnis-mention-rules"

/** 방에 안내 한 줄 — 시스템 글. sessionRoomId 가 있으면 화면이 「열기」 를 붙인다 */
export async function postNotice(roomId: string, content: string, sessionRoomId: string | null, at = new Date()) {
  const systemId = await getSystemUserId()
  const [row] = await prisma.$transaction([
    prisma.chatMessage.create({ data: { roomId, authorId: systemId, content, sessionRoomId, createdAt: at }, select: { id: true } }),
    prisma.chatRoom.update({ where: { id: roomId }, data: { lastMessageAt: at } }),
  ])
  return row.id
}

/**
 * 실행이 한 구간을 마쳤다 — 방에서 연 첫 실행(notifyOrigin)이면 그 방에 안내 한 줄.
 * 확인 대기는 알리고 끝을 닫지 않는다(확인 뒤 끝날 때 한 번 더). 끝(답 · 실패 · 한도 · 멈춤)은 한 번만 — 조건부 갱신으로 잡는다.
 * 실패해도 실행 저장을 막지 않는다.
 */
export async function noticeRunEnd(run: { id: string; roomId: string; userId: string }, status: SessionEnd, answer?: string) {
  try {
    if (closesNotice(status)) {
      const claimed = await prisma.agentRun.updateMany({ where: { id: run.id, notifyOrigin: true }, data: { notifyOrigin: false } })
      if (claimed.count !== 1) return
    } else if (!(await prisma.agentRun.findFirst({ where: { id: run.id, notifyOrigin: true }, select: { id: true } }))) {
      return
    }
    const [session, user] = await Promise.all([
      prisma.chatRoom.findUnique({ where: { id: run.roomId }, select: { originRoomId: true } }),
      prisma.user.findUnique({ where: { id: run.userId }, select: { name: true } }),
    ])
    if (!session?.originRoomId) return
    await postNotice(session.originRoomId, sessionNotice({ kind: "end", status, requesterName: user?.name ?? "", answer }), run.roomId)
  } catch (err) {
    console.error("[omnis-mention] 방 안내 실패", { runId: run.id, err })
  }
}

/**
 * 방을 볼 수 있는 사람 — 전사방은 재직 구성원 모두(참여자 행이 없다), 사람 방은 지금 참여자.
 * 세션을 방에 공유하면 이 사람들이 세션 참여자(ROOM)가 된다
 */
export async function originMemberIds(roomId: string): Promise<string[]> {
  const room = await prisma.chatRoom.findUnique({ where: { id: roomId }, select: { kind: true } })
  if (!room) return []
  if (room.kind === "COMPANY") {
    const users = await prisma.user.findMany({ where: { ...ACTIVE_MEMBER_WHERE, id: { not: SYSTEM_USER_ID } }, select: { id: true } })
    return users.map((u) => u.id)
  }
  return (await prisma.chatRoomMember.findMany({ where: { roomId }, select: { userId: true } })).map((m) => m.userId)
}

/**
 * 방의 참여자가 바뀌었다(초대 · 나가기 · 방 공유) — 그 방에 공유된 세션들의 방 공유(ROOM) 참여자를 방과 같게 맞춘다.
 * 나간 사람은 세션도 더는 못 보고, 새로 들어온 사람은 그 방의 지난 글처럼 세션도 본다.
 * 주인 · 사람 공유(PERSON) 행은 건드리지 않는다(lib/omnis-session-share-rules.ts planRoomSync). 돌려주는 값은 새로 들어온 사람.
 * 전사방은 공유한 그때의 재직자로 맞춘다 — 그 뒤 입사한 사람은 다시 공유해야 본다
 */
export async function syncSessionMembers(originRoomId: string, onlySessionId?: string): Promise<string[]> {
  const [ids, sessions] = await Promise.all([
    originMemberIds(originRoomId),
    prisma.chatRoom.findMany({
      where: { originRoomId, kind: "OMNIS_DM", ...(onlySessionId ? { id: onlySessionId } : {}) },
      select: { id: true, members: { select: { userId: true, shareKind: true } } },
    }),
  ])
  const added: string[] = []
  for (const session of sessions) {
    const plan = planRoomSync(session.members, ids)
    if (plan.remove.length === 0 && plan.add.length === 0) continue
    await prisma.$transaction([
      prisma.chatRoomMember.deleteMany({ where: { roomId: session.id, shareKind: "ROOM", userId: { in: plan.remove } } }),
      prisma.chatRoomMember.createMany({ data: plan.add.map((userId) => ({ roomId: session.id, userId, shareKind: "ROOM" as const })), skipDuplicates: true }),
    ])
    added.push(...plan.add)
  }
  return [...new Set(added)]
}
