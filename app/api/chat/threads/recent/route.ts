import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

export const runtime = "nodejs"

/**
 * 로그인한 사용자가 최근 대화한 업무 스레드 상위 3개를 반환한다.
 * 본인이 메시지를 보낸 업무를 마지막 메시지 시각 내림차순으로 정렬한다.
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const grouped = await prisma.chatMessage.groupBy({
    by: ["taskId"],
    where: { authorId: session.user.id, taskId: { not: null } },
    _max: { createdAt: true },
    orderBy: { _max: { createdAt: "desc" } },
    take: 8,
  })

  const orderedTaskIds = grouped
    .map((g) => g.taskId)
    .filter((id): id is string => id !== null)

  if (orderedTaskIds.length === 0) {
    return NextResponse.json([])
  }

  // archived된 업무는 제외
  const tasks = await prisma.task.findMany({
    where: { id: { in: orderedTaskIds }, archived: false },
    select: { id: true, name: true, slug: true },
  })
  const taskMap = new Map(tasks.map((t) => [t.id, t]))

  const threads = orderedTaskIds
    .map((id) => taskMap.get(id))
    .filter((t): t is NonNullable<typeof t> => t !== undefined)
    .slice(0, 3)

  return NextResponse.json(threads)
}
