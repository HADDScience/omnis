// 옴니스 1:1 방 — 묻고, 답을 방에 남기고, 다음 질문에 앞의 대화를 문맥으로 넣는다.
// 계획: mydocs/plans/2026-10-28-omnis-messenger-agent.md 2단계(읽기 에이전트)
//
// 답은 지금의 읽기 도구(lib/omnis-ask.ts askOmnisRoute)가 만든다. 쓰기 도구 · 확인 카드는 3단계다.
// 옴니스 글의 작성자는 시스템 계정(id "system"), 출처는 OmnisQuery 에 있고 글이 omnisQueryId 로 가리킨다.
import { prisma } from "@/lib/db"
import type { Prisma } from "@/generated/prisma/client"
import { askOmnisRoute, type AskSource } from "@/lib/omnis-ask"
import { buildOmnisHistory, HISTORY_MAX_MESSAGES } from "@/lib/omnis-history"
import { getSystemUserId, SYSTEM_USER_ID } from "@/lib/system-user"

export interface OmnisRoomMessage {
  id: string
  content: string
  createdAt: string
  fromOmnis: boolean
  sources: AskSource[]
  /** 옴니스가 만든 파일(4단계 결과물) — 옴니스 글에 붙는다. 방 주인만 연다(lib/agent/room-files.ts) */
  files?: { id: string; name: string; path: string; size: number; mimeType: string }[]
}

/** 방 이름 — 첫 질문 앞부분. ChatGPT 의 세션 제목처럼 목록에서 방을 알아보는 데 쓴다 */
const ROOM_NAME_MAX = 30

const MESSAGE_SELECT = {
  id: true,
  content: true,
  createdAt: true,
  authorId: true,
  omnisQuery: { select: { sources: true } },
} satisfies Prisma.ChatMessageSelect

type Row = Prisma.ChatMessageGetPayload<{ select: typeof MESSAGE_SELECT }>

function shape(m: Row): OmnisRoomMessage {
  return {
    id: m.id,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
    fromOmnis: m.authorId === SYSTEM_USER_ID,
    sources: Array.isArray(m.omnisQuery?.sources) ? (m.omnisQuery.sources as unknown as AskSource[]) : [],
  }
}

export function roomNameFrom(question: string): string {
  const flat = question.replace(/\s+/g, " ").trim()
  return flat.length > ROOM_NAME_MAX ? `${flat.slice(0, ROOM_NAME_MAX)}…` : flat
}

/** 방 화면 첫 그림. 내 옴니스 방이 아니면 null — 화면은 404 로 그린다 */
export async function loadOmnisRoom(roomId: string, userId: string) {
  const room = await prisma.chatRoom.findFirst({
    where: { id: roomId, kind: "OMNIS_DM", members: { some: { userId } } },
    select: { id: true, name: true },
  })
  if (!room) return null
  const [rows] = await Promise.all([
    prisma.chatMessage.findMany({
      where: { roomId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: MESSAGE_SELECT,
    }),
    prisma.chatRoomMember.update({ where: { roomId_userId: { roomId, userId } }, data: { lastReadAt: new Date() } }),
  ])
  return { room, messages: rows.map(shape) }
}

export type AskInRoomResult =
  | { ok: true; question: OmnisRoomMessage; answer: OmnisRoomMessage }
  | { ok: false; status: number; error: string; question?: OmnisRoomMessage }

/**
 * 옴니스 방에 묻는다. content 면 새 글을 남기고, retryOf 면 답을 못 받은 내 글을 다시 묻는다(글을 두 번 남기지 않는다).
 * 질문 글은 답보다 먼저 남긴다 — 답을 만들다 실패해도 무엇을 물었는지는 방에 있고, 화면이 「다시 묻기」 를 띄운다.
 */
export async function askInOmnisRoom(input: {
  roomId: string
  userId: string
  content?: string
  retryOf?: string
}): Promise<AskInRoomResult> {
  const { roomId, userId } = input
  const room = await prisma.chatRoom.findFirst({
    where: { id: roomId, kind: "OMNIS_DM", members: { some: { userId } } },
    select: { id: true },
  })
  if (!room) return { ok: false, status: 404, error: "대화를 찾을 수 없습니다" }

  let question: Row
  if (input.retryOf) {
    const target = await prisma.chatMessage.findFirst({
      where: { id: input.retryOf, roomId, authorId: userId, deletedAt: null },
      select: MESSAGE_SELECT,
    })
    if (!target) return { ok: false, status: 404, error: "다시 물을 글을 찾을 수 없습니다" }
    const answered = await prisma.chatMessage.count({
      where: { roomId, authorId: SYSTEM_USER_ID, createdAt: { gt: target.createdAt } },
    })
    if (answered > 0) return { ok: false, status: 409, error: "이미 답을 받은 글입니다" }
    question = target
  } else if (input.content) {
    const now = new Date()
    ;[question] = await prisma.$transaction([
      prisma.chatMessage.create({ data: { roomId, authorId: userId, content: input.content, createdAt: now }, select: MESSAGE_SELECT }),
      prisma.chatRoom.update({ where: { id: roomId }, data: { lastMessageAt: now } }),
    ])
  } else {
    return { ok: false, status: 400, error: "보낼 내용이 없습니다" }
  }

  // 이번 질문 앞의 글만 문맥으로 — 넉넉히 읽고 상한은 buildOmnisHistory 가 정한다
  const before = await prisma.chatMessage.findMany({
    where: { roomId, deletedAt: null, createdAt: { lt: question.createdAt } },
    orderBy: { createdAt: "desc" },
    take: HISTORY_MAX_MESSAGES * 2,
    select: { content: true, authorId: true },
  })
  const history = buildOmnisHistory(before.reverse().map((m) => ({ fromOmnis: m.authorId === SYSTEM_USER_ID, content: m.content })))

  let result: Awaited<ReturnType<typeof askOmnisRoute>>
  try {
    result = await askOmnisRoute(question.content, userId, { history, endpoint: "omnisAsk.room" })
  } catch (err) {
    console.error("[omnis-room] 답 생성 실패", { roomId, err })
    const limit = err instanceof Error && /한도/.test(err.message)
    return {
      ok: false,
      status: limit ? 429 : 502,
      error: limit ? "오늘 AI 사용 한도에 닿았습니다. 내일 다시 물어 주세요" : "답을 만들지 못했습니다. 잠시 뒤 다시 물어 주세요",
      question: shape(question),
    }
  }

  const systemId = await getSystemUserId()
  const now = new Date()
  const [answer] = await prisma.$transaction([
    prisma.chatMessage.create({
      data: { roomId, authorId: systemId, content: result.answer, omnisQueryId: result.id, createdAt: now },
      select: MESSAGE_SELECT,
    }),
    prisma.chatRoom.update({ where: { id: roomId }, data: { lastMessageAt: now } }),
  ])
  return { ok: true, question: shape(question), answer: shape(answer) }
}

/** 새 대화 — 첫 글과 함께 방을 만들고 바로 묻는다. 빈 방은 만들지 않는다(「새 대화」 를 눌렀다 떠나면 목록에 빈 방이 쌓인다) */
export async function createOmnisRoom(userId: string, content: string) {
  const room = await prisma.chatRoom.create({
    data: {
      name: roomNameFrom(content),
      kind: "OMNIS_DM",
      createdById: userId,
      members: { create: { userId, lastReadAt: new Date() } },
    },
    select: { id: true, name: true },
  })
  const result = await askInOmnisRoom({ roomId: room.id, userId, content })
  return { room, result }
}
