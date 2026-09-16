import { after, NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import { postChatMessage, runTaskRebuild } from "@/lib/chat-post"
import { CHAT_DELETED_TEXT, CHAT_PAGE_SIZE } from "@/lib/constants"

// 응답 뒤 AI 재구성(after)이 이 함수 수명 안에서 돈다 — 실측 8~13초, 넉넉히 둔다
export const maxDuration = 60

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

  // after: 폴링(새 메시지) / before: 무한 스크롤(이전 메시지) / 둘 다 없음: 초기 로드(최신 페이지)
  const isPolling = !!after

  const messages = await prisma.chatMessage.findMany({
    where: {
      roomId,
      ...(taskId ? { taskId } : {}),
      ...(after ? { createdAt: { gt: new Date(after) } } : {}),
      ...(before ? { createdAt: { lt: new Date(before) } } : {}),
    },
    // 폴링은 오름차순 누적, 그 외에는 최신순 한 페이지를 가져온 뒤 뒤집어 반환
    orderBy: { createdAt: isPolling ? "asc" : "desc" },
    take: isPolling ? 200 : CHAT_PAGE_SIZE,
    include: {
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
    },
  })

  // 지운 글은 자리만 남긴다 — 본문과 첨부는 내려보내지 않는다(행은 DB 에 그대로 있다)
  const shaped = messages.map((m) => ({
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
  }))

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
