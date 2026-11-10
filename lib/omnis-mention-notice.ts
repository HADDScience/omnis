// 옴니스 세션 ↔ 사람 방 — 안내 줄(에이전트 저장 lib/agent/store.ts 가 부른다)과 참여자 맞추기(초대 · 나가기가 부른다).
// lib/omnis-mention.ts 는 에이전트 서비스를 불러 무겁고 순환하므로 가벼운 이쪽에 따로 둔다.
import { prisma } from "@/lib/db"
import { getSystemUserId } from "@/lib/system-user"
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
 * 방의 참여자가 바뀌었다(초대 · 나가기) — 그 방에서 연 세션들의 참여자를 방과 같게 맞춘다.
 * 나간 사람은 세션도 더는 못 보고, 새로 들어온 사람은 그 방의 지난 글처럼 세션도 본다.
 */
export async function syncSessionMembers(originRoomId: string) {
  const [members, sessions] = await Promise.all([
    prisma.chatRoomMember.findMany({ where: { roomId: originRoomId }, select: { userId: true } }),
    prisma.chatRoom.findMany({ where: { originRoomId, kind: "OMNIS_DM" }, select: { id: true } }),
  ])
  if (sessions.length === 0) return
  const ids = members.map((m) => m.userId)
  const sessionIds = sessions.map((s) => s.id)
  await prisma.$transaction([
    prisma.chatRoomMember.deleteMany({ where: { roomId: { in: sessionIds }, userId: { notIn: ids } } }),
    prisma.chatRoomMember.createMany({ data: sessionIds.flatMap((roomId) => ids.map((userId) => ({ roomId, userId }))), skipDuplicates: true }),
  ])
}
