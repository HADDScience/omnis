import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { REBUILD_FINISHED_ACTION } from "@/lib/chat-post"

interface Props {
  params: Promise<{ taskId: string }>
}

/**
 * 메시지 한 건의 AI 재구성이 끝났는지. 채팅 · 스레드가 「갱신 중」 을 거둘 때 2초마다 묻는다.
 * 재구성은 응답 뒤(after)에 돌고 끝나면 활동 기록을 남긴다(lib/chat-post runTaskRebuild) — 변경 없음 · 실패 · 더 새 글에 넘김도 끝이다.
 */
export async function GET(req: NextRequest, { params }: Props) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const { taskId } = await params
  const messageId = req.nextUrl.searchParams.get("messageId")
  if (!messageId) return NextResponse.json({ error: "messageId 필수" }, { status: 400 })

  // 활동 기록은 업무별 · 시간순 색인이 있다. 방금 보낸 글이므로 최근 10분만 본다
  const logs = await prisma.activityLog.findMany({
    where: {
      entity: "task",
      entityId: taskId,
      action: REBUILD_FINISHED_ACTION,
      createdAt: { gte: new Date(Date.now() - 10 * 60_000) },
    },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { metadata: true },
  })
  const hit = logs
    .map((l) => l.metadata as { messageId?: string; outcome?: string } | null)
    .find((m) => m?.messageId === messageId)

  return NextResponse.json({ done: !!hit, outcome: hit?.outcome ?? null })
}
