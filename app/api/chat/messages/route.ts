import { after, NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import type { Prisma } from "@/generated/prisma/client"
import { auth } from "@/lib/auth"
import { postChatMessage, runTaskRebuild } from "@/lib/chat-post"
import { CHAT_DELETED_TEXT, CHAT_PAGE_SIZE } from "@/lib/constants"
import { roomAccess } from "@/lib/chat-rooms"
import { loadPeopleRoom, postPeopleMessage } from "@/lib/chat-people"
import { AttachFileIdsSchema } from "@/lib/schemas/chat-room"
import { newerThan, olderThan, parseCursor, pollSince } from "@/lib/chat-cursor"

// 응답 뒤 AI 재구성(after)이 이 함수 수명 안에서 돈다 — 실측 8~13초, 넉넉히 둔다
export const maxDuration = 60

const MESSAGE_INCLUDE = {
  author: { select: { id: true, name: true } },
  // TASK_CREATED 메시지가 생성된 업무의 프리뷰 카드를 그릴 수 있도록 핵심 필드 포함
  task: {
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      priority: true,
      deadline: true,
      assignees: { select: { user: { select: { id: true, name: true } } } },
      _count: { select: { checklists: true } },
    },
  },
  files: { select: { id: true, name: true, path: true, size: true, mimeType: true } },
  replyTo: { select: { id: true, content: true, deletedAt: true, author: { select: { name: true } } } },
} satisfies Prisma.ChatMessageInclude

type MessageRow = Prisma.ChatMessageGetPayload<{ include: typeof MESSAGE_INCLUDE }>

// 지운 글은 자리만 남긴다 — 본문과 첨부는 내려보내지 않는다(행은 DB 에 그대로 있다)
function shape(m: MessageRow) {
  return {
    ...m,
    content: m.deletedAt ? CHAT_DELETED_TEXT : m.content,
    files: m.deletedAt ? [] : m.files,
    replyTo: m.replyTo
      ? {
          id: m.replyTo.id,
          authorName: m.replyTo.author.name,
          content: m.replyTo.deletedAt ? CHAT_DELETED_TEXT : m.replyTo.content.slice(0, 80),
        }
      : null,
  }
}

/** 사람끼리 방 글 한 줄 상한 — 전사방 글에는 상한이 없었다. 새 길이라 둔다 */
const PEOPLE_MESSAGE_MAX = 4000

/** 답장 인용을 화면 모양(작성자 · 앞 80자)으로 */
function shapeReply<T extends { replyTo: { id: string; content: string; deletedAt: Date | null; author: { name: string } } | null }>(m: T) {
  return {
    ...m,
    replyTo: m.replyTo
      ? {
          id: m.replyTo.id,
          authorName: m.replyTo.author.name,
          content: m.replyTo.deletedAt ? CHAT_DELETED_TEXT : m.replyTo.content.slice(0, 80),
        }
      : null,
  }
}

/** 검색 결과로 갈 때 — 대상 앞뒤로 이만큼씩 불러온다 */
const AROUND_SIZE = 15

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const roomId = searchParams.get("roomId")
  if (!roomId) return NextResponse.json({ error: "roomId 필수" }, { status: 400 })
  // 옴니스 1:1 · 단톡 방은 참여자만 읽는다. 없는 방은 예전처럼 빈 목록으로 떨어진다
  if ((await roomAccess(roomId, session.user.id)) === "forbidden") {
    return NextResponse.json({ error: "이 방을 볼 수 없습니다" }, { status: 403 })
  }

  const after = searchParams.get("after")
  const before = searchParams.get("before")
  const taskId = searchParams.get("taskId")
  const around = searchParams.get("around")
  // 날짜로 가기 — 그 시각 이후 첫 글(없으면 마지막 글) 주변
  const at = searchParams.get("at")
  const takeParam = Number(searchParams.get("take"))

  if (around || at) {
    const scope = { roomId, ...(taskId ? { taskId } : {}) }
    let target: MessageRow | null = null
    if (around) {
      target = await prisma.chatMessage.findFirst({ where: { id: around, ...scope }, include: MESSAGE_INCLUDE })
    } else {
      const when = new Date(at!)
      if (Number.isNaN(when.getTime())) return NextResponse.json({ error: "at 이 날짜가 아닙니다" }, { status: 400 })
      target =
        (await prisma.chatMessage.findFirst({
          where: { ...scope, createdAt: { gte: when } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          include: MESSAGE_INCLUDE,
        })) ??
        (await prisma.chatMessage.findFirst({
          where: scope,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          include: MESSAGE_INCLUDE,
        }))
    }
    if (!target) return NextResponse.json({ error: "메시지를 찾을 수 없습니다" }, { status: 404 })
    // 카톡 이식분은 초 단위라 같은 시각이 흔하다 — 시각이 같으면 id 로 앞뒤를 가른다
    const base = { roomId, ...(taskId ? { taskId } : {}) }
    const t = target.createdAt
    const [older, newer] = await Promise.all([
      prisma.chatMessage.findMany({
        where: { ...base, OR: [{ createdAt: { lt: t } }, { createdAt: t, id: { lt: target.id } }] },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: AROUND_SIZE,
        include: MESSAGE_INCLUDE,
      }),
      prisma.chatMessage.findMany({
        where: { ...base, OR: [{ createdAt: { gt: t } }, { createdAt: t, id: { gt: target.id } }] },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: AROUND_SIZE,
        include: MESSAGE_INCLUDE,
      }),
    ])
    return NextResponse.json({
      targetId: target.id,
      messages: [...older.reverse(), target, ...newer].map(shape),
      hasMoreOlder: older.length === AROUND_SIZE,
      hasMoreNewer: newer.length === AROUND_SIZE,
    })
  }

  // after: 폴링(새 메시지) / before: 무한 스크롤(이전 메시지) / 둘 다 없음: 초기 로드(최신 페이지)
  const isPolling = !!after
  // take: 검색 결과 보기에서 아래로 이어 불러올 때 한 페이지만. 폴링은 넉넉히 200
  const takeGiven = Number.isInteger(takeParam) && takeParam > 0 && takeParam <= 200
  const take = isPolling
    ? takeGiven ? takeParam : 200
    : CHAT_PAGE_SIZE

  // 커서는 `시각|id` — 시각만 보면 같은 시각의 글 · 늦게 커밋된 글이 빠진다(lib/chat-cursor.ts)
  const afterCursor = parseCursor(after)
  const beforeCursor = parseCursor(before)
  if ((after && !afterCursor) || (before && !beforeCursor)) {
    return NextResponse.json({ error: "커서가 날짜가 아닙니다" }, { status: 400 })
  }

  const direction = isPolling ? "asc" : "desc"
  const messages = await prisma.chatMessage.findMany({
    where: {
      roomId,
      ...(taskId ? { taskId } : {}),
      // take 를 준 것은 검색 결과 보기의 다음 페이지다 — 겹쳐 읽지 않고 딱 이어 붙인다
      ...(afterCursor ? (takeGiven ? newerThan(afterCursor) : pollSince(afterCursor)) : {}),
      ...(beforeCursor ? olderThan(beforeCursor) : {}),
    },
    // 폴링은 오름차순 누적, 그 외에는 최신순 한 페이지를 가져온 뒤 뒤집어 반환.
    // 시각이 같으면 id 로 — 페이지 경계가 매번 같은 자리에 선다
    orderBy: [{ createdAt: direction }, { id: direction }],
    take,
    include: MESSAGE_INCLUDE,
  })

  const shaped = messages.map(shape)

  // 초기 로드·이전 메시지는 desc로 가져왔으므로 화면 표시용 오름차순으로 정렬
  return NextResponse.json(isPolling ? shaped : shaped.reverse())
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const body = await req.json()
  const { roomId, content, taskId, fileIds, replyToId } = body

  if (!roomId || !content?.trim()) {
    return NextResponse.json({ error: "roomId, content 필수" }, { status: 400 })
  }
  // 전사방(팀 채팅 · 업무 스레드)은 postChatMessage, 사람끼리 방(1:1 · 단톡)은 postPeopleMessage.
  // 옴니스 방은 에이전트 API(/api/agent/rooms/…)로 쓴다 — 여기로 들어오면 업무 재구성 · 색인이 1:1 대화에 붙는다.
  // 없는 방은 postChatMessage 가 만든다(전사방)
  const access = await prisma.chatRoom.findUnique({ where: { id: roomId }, select: { kind: true } })
  if (access && (access.kind === "DM" || access.kind === "GROUP")) {
    // 참여자가 아니면 없는 방과 같은 404 — 403 이면 그 id 의 방이 있다는 것이 샌다
    const room = await loadPeopleRoom(roomId, session.user.id)
    if (!room) return NextResponse.json({ error: "방을 찾을 수 없습니다" }, { status: 404 })
    // 첨부 — scope=private 로 올린 내 파일만(lib/file-access.ts). 붙은 뒤에는 이 방 참여자만 목록 · 내려받기로 본다
    const files = AttachFileIdsSchema.optional().safeParse(fileIds ?? undefined)
    if (!files.success) return NextResponse.json({ error: files.error.issues[0]?.message ?? "잘못된 첨부입니다" }, { status: 400 })
    if (typeof content !== "string" || content.trim().length > PEOPLE_MESSAGE_MAX) {
      return NextResponse.json({ error: `${PEOPLE_MESSAGE_MAX}자 이내로 입력해 주세요` }, { status: 400 })
    }
    const posted = await postPeopleMessage({ id: session.user.id, name: session.user.name ?? "" }, room, { content, replyToId, fileIds: files.data })
    if (!posted.ok) return NextResponse.json({ error: posted.error }, { status: posted.status })
    return NextResponse.json({ ...shapeReply(posted.message), _taskUpdate: null, _rebuild: null }, { status: 201 })
  }
  if (access && access.kind !== "COMPANY") {
    return NextResponse.json({ error: "이 방에는 여기로 글을 쓸 수 없습니다" }, { status: 403 })
  }
  // 답장 대상은 같은 방의 글만 — 다른 방(1:1 · 단톡) 글 id 를 넣으면 그 글 앞 80자가 전사방 인용으로 샌다
  if (replyToId) {
    const target = await prisma.chatMessage.findFirst({ where: { id: replyToId, roomId }, select: { id: true } })
    if (!target) return NextResponse.json({ error: "답장할 글을 찾을 수 없습니다" }, { status: 400 })
  }

  const { message, taskUpdate, rebuild } = await postChatMessage(
    {
      user: { id: session.user.id, name: session.user.name ?? "" },
      roomId,
      content,
      taskId,
      fileIds,
      replyToId,
    },
    // 글은 바로 돌려주고 AI 재구성은 응답 뒤에 — 화면은 GET /api/tasks/[taskId]/rebuild-status 로 끝을 안다
    { deferRebuild: true },
  )
  if (rebuild) {
    after(async () => {
      await runTaskRebuild(rebuild)
    })
  }

  return NextResponse.json(
    { ...message, _taskUpdate: taskUpdate, _rebuild: rebuild ? "queued" : null },
    { status: 201 },
  )
}
