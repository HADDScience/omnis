// 사람끼리 대화(5단계) — 1:1(DM) · 단톡방(GROUP) 을 만들고, 열고, 초대하고, 나가고, 글을 쓴다.
// 순수 규칙: lib/chat-people-rules.ts · 결정과 실측: mydocs/working/2026-10-29-omnis-agent.md 「5단계」
//
// 이 방들의 글은 참여자만 본다. 그래서 전사방 글쓰기(lib/chat-post.ts)를 타지 않는다 — 그 길은
// 업무 연결 · AI 재구성 · 사내 지식 색인(임베딩) · 업무 알림을 붙인다. 여기서는 저장 · 방 시각 · 참여자 채팅 푸시 · 멘션 알림만 한다.
// 옴니스는 이 방들에 들어가지 않는다(@옴니스 호출도 이번 범위 밖, 작업지시자 결정 2026-10-29).
import { prisma } from "@/lib/db"
import type { Prisma } from "@/generated/prisma/client"
import { SYSTEM_USER_ID } from "@/lib/system-user"
import { createNotification } from "@/lib/notifications"
import { queueChatPush } from "@/lib/chat-push"
import { roomKeyOf } from "@/lib/chat-list"
import { checkAttachable } from "@/lib/file-access"
import { defaultGroupName, dmKeyOf, mentionedMembers, peopleRoomTitle, planPeopleRoom } from "@/lib/chat-people-rules"

export type PeopleResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string }
const fail = (status: number, error: string) => ({ ok: false as const, status, error })

const PEOPLE_KINDS = ["DM", "GROUP"] as const

/** 고를 수 있는 사람 — 로그인할 수 있는 구성원. 시스템 계정(isActive=false)은 빠진다 */
async function activeMembers(ids: string[]): Promise<Map<string, string>> {
  const rows = await prisma.user.findMany({
    where: { id: { in: ids, not: SYSTEM_USER_ID }, isActive: true },
    select: { id: true, name: true },
  })
  return new Map(rows.map((u) => [u.id, u.name]))
}

/**
 * 「사람과 대화」 — 1명이면 1:1 을 열거나(있으면 그 방) 만들고, 2명 이상이면 단톡방을 새로 만든다.
 * 1:1 은 dmKey 유일 제약이 지킨다 — 두 사람이 동시에 서로를 골라도 방은 하나다(P2002 를 받으면 있는 방을 연다).
 */
export async function openPeopleRoom(
  me: { id: string; name: string },
  input: { userIds: string[]; name?: string },
): Promise<PeopleResult<{ roomId: string; kind: "DM" | "GROUP"; existing: boolean }>> {
  const others = input.userIds.filter((id) => id !== me.id)
  const names = await activeMembers(others)
  const plan = planPeopleRoom(me.id, input.userIds, new Set(names.keys()))
  if ("error" in plan) return fail(400, plan.error)

  if (plan.kind === "DM") {
    const dmKey = dmKeyOf(me.id, plan.otherId)
    const found = await prisma.chatRoom.findUnique({ where: { dmKey }, select: { id: true } })
    if (found) {
      // 목록에서 숨겼던 1:1 을 다시 고르면 다시 보이게 — 숨김은 내 목록 정리일 뿐 방을 지운 것이 아니다
      await prisma.chatRoomPref.updateMany({ where: { userId: me.id, roomKey: `room:${found.id}`, hiddenAt: { not: null } }, data: { hiddenAt: null } })
      return { ok: true, value: { roomId: found.id, kind: "DM", existing: true } }
    }
    try {
      const room = await prisma.chatRoom.create({
        data: {
          kind: "DM",
          dmKey,
          // 화면은 보는 사람마다 상대 이름을 쓴다(peopleRoomTitle). 저장 이름은 두 사람 — 운영 DB 를 읽을 때 알아보게
          name: `${me.name}, ${names.get(plan.otherId)}`,
          createdById: me.id,
          members: { create: [{ userId: me.id, lastReadAt: new Date() }, { userId: plan.otherId }] },
        },
        select: { id: true },
      })
      return { ok: true, value: { roomId: room.id, kind: "DM", existing: false } }
    } catch (e) {
      if ((e as { code?: string } | null)?.code === "P2002") {
        const again = await prisma.chatRoom.findUnique({ where: { dmKey }, select: { id: true } })
        if (again) return { ok: true, value: { roomId: again.id, kind: "DM", existing: true } }
      }
      throw e
    }
  }

  const otherIds = plan.memberIds.filter((id) => id !== me.id)
  const name = input.name?.trim() || defaultGroupName(otherIds.map((id) => names.get(id) ?? ""), me.name)
  const room = await prisma.chatRoom.create({
    data: {
      kind: "GROUP",
      name,
      createdById: me.id,
      members: { create: plan.memberIds.map((userId) => ({ userId, ...(userId === me.id ? { lastReadAt: new Date() } : {}) })) },
    },
    select: { id: true },
  })
  return { ok: true, value: { roomId: room.id, kind: "GROUP", existing: false } }
}

export interface PeopleRoomView {
  id: string
  kind: "DM" | "GROUP"
  /** 보는 사람 기준 이름 — 1:1 은 상대 이름 */
  title: string
  /** 저장된 이름(단톡방 이름 바꾸기의 기본값) */
  name: string
  members: { id: string; name: string }[]
}

/** 내가 참여한 사람끼리 방. 아니면 null — 호출자가 404 로 답한다(있는지조차 알리지 않는다) */
export async function loadPeopleRoom(roomId: string, userId: string): Promise<PeopleRoomView | null> {
  const room = await prisma.chatRoom.findFirst({
    where: { id: roomId, kind: { in: [...PEOPLE_KINDS] }, members: { some: { userId } } },
    select: {
      id: true, kind: true, name: true,
      members: { orderBy: { joinedAt: "asc" }, select: { user: { select: { id: true, name: true } } } },
    },
  })
  if (!room || (room.kind !== "DM" && room.kind !== "GROUP")) return null
  const members = room.members.map((m) => m.user)
  return { id: room.id, kind: room.kind, name: room.name, title: peopleRoomTitle(room, members, userId), members }
}

/** 단톡방 이름 바꾸기 — 참여자 누구나. 1:1 은 이름이 상대 이름이라 바꾸지 않는다 */
export async function renamePeopleRoom(roomId: string, userId: string, name: string): Promise<PeopleResult<null>> {
  const room = await loadPeopleRoom(roomId, userId)
  if (!room) return fail(404, "방을 찾을 수 없습니다")
  if (room.kind !== "GROUP") return fail(400, "1:1 대화는 이름을 바꿀 수 없어요")
  await prisma.chatRoom.update({ where: { id: roomId }, data: { name: name.trim() } })
  return { ok: true, value: null }
}

/** 단톡방에 초대 — 참여자 누구나. 이미 있는 사람은 건너뛴다. 1:1 에는 초대하지 않는다(새 단톡방을 만든다) */
export async function invitePeople(roomId: string, userId: string, userIds: string[]): Promise<PeopleResult<{ added: number }>> {
  const room = await loadPeopleRoom(roomId, userId)
  if (!room) return fail(404, "방을 찾을 수 없습니다")
  if (room.kind !== "GROUP") return fail(400, "1:1 대화에는 초대할 수 없어요. 「사람과 대화」 에서 단톡방을 만들어 주세요")
  const wanted = [...new Set(userIds)].filter((id) => !room.members.some((m) => m.id === id))
  if (wanted.length === 0) return { ok: true, value: { added: 0 } }
  const names = await activeMembers(wanted)
  if (names.size !== wanted.length) return fail(400, "고를 수 없는 사람이 들어 있습니다")
  const res = await prisma.chatRoomMember.createMany({ data: wanted.map((id) => ({ roomId, userId: id })), skipDuplicates: true })
  return { ok: true, value: { added: res.count } }
}

/**
 * 단톡방 나가기. 참여자 행을 지우면 그 순간부터 방 · 글 · 검색 · 목록에서 사라진다(참여자 조건).
 * 내 방 설정(읽음 · 즐겨찾기)과 내 수동 폴더에 넣어 둔 이 방도 함께 지운다 — 다시 초대받으면 새로 시작한다.
 * 마지막 사람이 나가도 방과 글은 지우지 않는다(아무도 열 수 없다).
 */
export async function leavePeopleRoom(roomId: string, userId: string): Promise<PeopleResult<null>> {
  const room = await loadPeopleRoom(roomId, userId)
  if (!room) return fail(404, "방을 찾을 수 없습니다")
  if (room.kind !== "GROUP") return fail(400, "1:1 대화는 나갈 수 없어요")
  const key = roomKeyOf({ kind: "GROUP", id: roomId })
  await prisma.$transaction([
    prisma.chatRoomMember.delete({ where: { roomId_userId: { roomId, userId } } }),
    prisma.chatRoomPref.deleteMany({ where: { userId, roomKey: key } }),
    prisma.chatFolderRoom.deleteMany({ where: { roomKey: key, folder: { userId } } }),
  ])
  return { ok: true, value: null }
}

const MESSAGE_INCLUDE = {
  author: { select: { id: true, name: true } },
  task: { select: { id: true, name: true, slug: true } },
  files: { select: { id: true, name: true, path: true, size: true, mimeType: true } },
  replyTo: { select: { id: true, content: true, deletedAt: true, author: { select: { name: true } } } },
} satisfies Prisma.ChatMessageInclude

/** 알림 한 줄에 보일 본문 길이 */
const NOTIFY_PREVIEW = 80

/** 트랜잭션 안에서 첨부를 잡지 못했다 — 그사이 다른 글에 붙었다. 글까지 되돌린다 */
class AttachRace extends Error {}

/**
 * 사람끼리 방에 글 하나. 업무 연결 · 재구성 · 색인 · ChatMention 을 하지 않는다 — 방 밖으로 내용이 나가는 길이 그것들이다.
 * 답장 대상은 **같은 방의 글**만 받는다(다른 방 글 id 를 넣어 인용으로 끌어오지 못하게).
 * `@이름` 이 이 방 참여자면 그 사람에게만 알림(chat_mention → /chat/<방>)을 보낸다.
 * fileIds — scope=private 로 올린 내 파일만 붙는다(lib/file-access.ts checkAttachable). 붙은 뒤에는 이 방 참여자만 본다.
 * 사진 설명 · 색인을 만들지 않는다(lib/photo-describe.ts · embeddings.ts 가 전사방만 다룬다)
 */
export async function postPeopleMessage(
  me: { id: string; name: string },
  room: PeopleRoomView,
  input: { content: string; replyToId?: string | null; fileIds?: string[] },
): Promise<{ ok: true; message: Prisma.ChatMessageGetPayload<{ include: typeof MESSAGE_INCLUDE }> } | { ok: false; status: number; error: string }> {
  const content = input.content.trim()
  const fileIds = input.fileIds ?? []
  if (fileIds.length) {
    const found = await prisma.file.findMany({ where: { id: { in: fileIds } }, select: { id: true, privateToUserId: true, messageId: true, taskId: true } })
    const check = checkAttachable(fileIds, found, me.id)
    if (!check.ok) return check
  }
  const replyOk = input.replyToId
    ? !!(await prisma.chatMessage.findFirst({ where: { id: input.replyToId, roomId: room.id }, select: { id: true } }))
    : false
  let message: Prisma.ChatMessageGetPayload<{ include: typeof MESSAGE_INCLUDE }>
  try {
    message = await prisma.$transaction(async (tx) => {
      const created = await tx.chatMessage.create({
        data: { roomId: room.id, authorId: me.id, content, replyToId: replyOk ? input.replyToId! : null },
        select: { id: true },
      })
      await tx.chatRoom.update({ where: { id: room.id }, data: { lastMessageAt: new Date() } })
      if (fileIds.length) {
        // 위에서 본 뒤 그사이 다른 글에 붙었으면 잡지 못한다 — 글까지 되돌린다
        const claimed = await tx.file.updateMany({
          where: { id: { in: fileIds }, privateToUserId: me.id, messageId: null, taskId: null },
          data: { messageId: created.id },
        })
        if (claimed.count !== fileIds.length) throw new AttachRace()
      }
      return tx.chatMessage.findUniqueOrThrow({ where: { id: created.id }, include: MESSAGE_INCLUDE })
    })
  } catch (err) {
    if (err instanceof AttachRace) return { ok: false, status: 409, error: "이미 다른 글에 붙은 파일입니다 — 다시 올려 주세요" }
    throw err
  }

  const targets = mentionedMembers(content, room.members, me.id)
  // 참여자에게 채팅 푸시(벨 없이) — 멘션 받는 사람은 아래 chat_mention 으로 한 번만 울린다
  queueChatPush({
    room: { kind: room.kind, id: room.id, name: room.title, memberIds: room.members.map((m) => m.id) },
    author: me,
    content,
    mentionedUserIds: targets,
  })
  if (targets.length > 0) {
    const where = room.kind === "DM" ? "1:1 대화" : `「${room.title}」`
    const preview = content.length > NOTIFY_PREVIEW ? `${content.slice(0, NOTIFY_PREVIEW)}…` : content
    await Promise.all(
      targets.map((uid) =>
        createNotification(uid, "chat_mention", `${me.name}님이 ${where}에서 불렀어요`, preview, room.id).catch((e) =>
          console.error("[chat-people] 멘션 알림 실패", e),
        ),
      ),
    )
  }
  return { ok: true, message }
}
