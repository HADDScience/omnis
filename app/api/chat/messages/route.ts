import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import { postChatMessage } from "@/lib/chat-post"
import { CHAT_PAGE_SIZE } from "@/lib/constants"

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
    },
  })

  // 초기 로드·이전 메시지는 desc로 가져왔으므로 화면 표시용 오름차순으로 정렬
  return NextResponse.json(isPolling ? messages : messages.reverse())
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const body = await req.json()
  const { roomId, content, taskId, fileIds } = body

  if (!roomId || !content?.trim()) {
    return NextResponse.json({ error: "roomId, content 필수" }, { status: 400 })
  }

  const { message, taskUpdate } = await postChatMessage({
    user: { id: session.user.id, name: session.user.name ?? "" },
    roomId,
    content,
    taskId,
    fileIds,
  })

  return NextResponse.json({ ...message, _taskUpdate: taskUpdate }, { status: 201 })
}
