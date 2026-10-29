// 채팅 글 · 옴니스 답 푸시 — 벨 행(Notification)을 만들지 않고 기기 알림만 보낸다(방 목록의 안읽음 배지가 따로 있다).
// 받는 사람 규칙의 정본은 lib/notify-rules.ts(순수 함수)다. 여기서는 그 규칙이 볼 사실을 DB 에서 모으고 보낸다.
// 결정: mydocs/plans/2026-10-29-push-notifications.md
//
// 질의는 받는 사람 수와 상관없이 고정이다 — 후보 · 활성 여부 · 끈 방 · 끈 종류를 한 번씩, 구독을 한 번(deliverPush).
import { prisma } from "@/lib/db"
import { SYSTEM_USER_ID } from "@/lib/system-user"
import { deliverPush, pushOffUserIds } from "@/lib/push"
import { runAfterResponse } from "@/lib/after-response"
import {
  agentPushPayload,
  chatCandidates,
  chatPushPayload,
  chatRecipients,
  chatRoomKey,
  type AgentPushKind,
  type ChatAudience,
} from "@/lib/notify-rules"

export type ChatPushRoom =
  | { kind: "COMPANY"; id: string; name: string }
  /** 업무방 — id 는 업무 id */
  | { kind: "TASK"; id: string; name: string }
  | { kind: "DM" | "GROUP"; id: string; name: string; memberIds: string[] }

export interface ChatPushInput {
  room: ChatPushRoom
  author: { id: string; name: string }
  content: string
  /** 같은 글로 chat_mention(벨 + 푸시)을 받는 사람 — 두 번 울리지 않게 뺀다 */
  mentionedUserIds?: string[]
}

async function audienceOf(room: ChatPushRoom): Promise<ChatAudience> {
  if (room.kind === "COMPANY") {
    const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true } })
    return { kind: "COMPANY", activeUserIds: users.map((u) => u.id) }
  }
  if (room.kind === "TASK") {
    const [task, authors, favorites] = await Promise.all([
      prisma.task.findUnique({ where: { id: room.id }, select: { instructorId: true, assignees: { select: { userId: true } } } }),
      // 업무방 글 = 전사방에 있는 그 업무의 글(사람끼리 방 글은 업무에 잇지 않는다)
      prisma.chatMessage.findMany({
        where: { taskId: room.id, deletedAt: null, room: { kind: "COMPANY" } },
        distinct: ["authorId"],
        select: { authorId: true },
      }),
      prisma.chatRoomPref.findMany({ where: { roomKey: chatRoomKey(room), favorite: true }, select: { userId: true } }),
    ])
    return {
      kind: "TASK",
      assigneeIds: task?.assignees.map((a) => a.userId) ?? [],
      instructorId: task?.instructorId ?? "",
      threadAuthorIds: authors.map((a) => a.authorId),
      favoriteUserIds: favorites.map((f) => f.userId),
    }
  }
  return { kind: room.kind, memberIds: room.memberIds }
}

/** 이 방 · 이 후보들 중 끈 방 · 끈 종류 · 활성 여부 */
async function filtersFor(roomKey: string, candidates: string[]) {
  const ids = [...new Set(candidates)]
  const [active, muted, chatOff] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } }),
    prisma.chatRoomPref.findMany({ where: { roomKey, muted: true, userId: { in: ids } }, select: { userId: true } }),
    pushOffUserIds(ids, "chat"),
  ])
  return { activeUserIds: active.map((u) => u.id), mutedUserIds: muted.map((m) => m.userId), chatOffUserIds: chatOff }
}

/** 채팅 글 하나의 푸시. 보낸 사람 id 들을 돌려준다(검증 스크립트가 본다) */
export async function dispatchChatPush(input: ChatPushInput): Promise<string[]> {
  if (input.author.id === SYSTEM_USER_ID) return []
  const audience = await audienceOf(input.room)
  const candidates = chatCandidates(audience)
  if (candidates.length === 0) return []
  const filters = await filtersFor(chatRoomKey(input.room), candidates)
  const recipients = chatRecipients({
    audience,
    authorId: input.author.id,
    systemUserId: SYSTEM_USER_ID,
    ...filters,
    mentionedUserIds: input.mentionedUserIds,
  })
  if (recipients.length === 0) return []
  await deliverPush(recipients, chatPushPayload({ room: input.room, authorName: input.author.name, content: input.content }), "chat")
  return recipients
}

/** 응답 뒤에 보낸다 — 글쓰기 응답을 늦추지 않고, 실패해도 글은 이미 저장됐다 */
export function queueChatPush(input: ChatPushInput): void {
  runAfterResponse("chat-push", () => dispatchChatPush(input))
}

/**
 * 옴니스 1:1 의 답 · 확인 카드 · 한도 멈춤 푸시. 방 주인 한 명에게, 그 방을 껐거나 채팅 알림을 껐으면 보내지 않는다.
 * 보고 있으면 service worker 가 띄우지 않는다(roomPath). Workflow 단계에서 부르므로 기다려서 보낸다.
 */
export async function dispatchAgentPush(input: { roomId: string; userId: string; kind: AgentPushKind; text?: string }): Promise<boolean> {
  const room = await prisma.chatRoom.findUnique({ where: { id: input.roomId }, select: { id: true, name: true, kind: true } })
  if (!room || room.kind !== "OMNIS_DM") return false
  const roomKey = chatRoomKey({ kind: "OMNIS_DM", id: room.id })
  const filters = await filtersFor(roomKey, [input.userId])
  const recipients = chatRecipients({
    audience: { kind: "OMNIS_DM", memberIds: [input.userId] },
    // 옴니스 답의 글쓴이는 시스템 계정이지만 이 길은 그 방 주인에게 보내는 답이다 — 글쓴이 자리에 빈 값을 둔다
    authorId: "",
    systemUserId: SYSTEM_USER_ID,
    ...filters,
  })
  if (recipients.length === 0) return false
  await deliverPush(recipients, agentPushPayload({ roomId: room.id, roomName: room.name, kind: input.kind, text: input.text }), "chat")
  return true
}

/** 던지지 않는다 — 답 저장 · 카드 저장이 푸시 때문에 실패하면 안 된다 */
export async function dispatchAgentPushSafe(input: Parameters<typeof dispatchAgentPush>[0]): Promise<void> {
  await dispatchAgentPush(input).catch((err) => console.error("[chat-push] 옴니스 답 푸시 실패", { roomId: input.roomId, err }))
}
