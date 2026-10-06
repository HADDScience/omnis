import { after, NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import type { Prisma } from "@/generated/prisma/client"
import { auth } from "@/lib/auth"
import { postChatMessage, runTaskRebuild } from "@/lib/chat-post"
import { CHAT_DELETED_TEXT, CHAT_PAGE_SIZE } from "@/lib/constants"

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
  const take = isPolling
    ? Number.isInteger(takeParam) && takeParam > 0 && takeParam <= 200 ? takeParam : 200
    : CHAT_PAGE_SIZE

  const messages = await prisma.chatMessage.findMany({
    where: {
      roomId,
      ...(taskId ? { taskId } : {}),
      ...(after ? { createdAt: { gt: new Date(after) } } : {}),
      ...(before ? { createdAt: { lt: new Date(before) } } : {}),
    },
    // 폴링은 오름차순 누적, 그 외에는 최신순 한 페이지를 가져온 뒤 뒤집어 반환
    orderBy: { createdAt: isPolling ? "asc" : "desc" },
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
