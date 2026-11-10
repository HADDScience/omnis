import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import { apiError } from "@/lib/api"
import type { TaskStartInput } from "@/lib/task-start"

interface Props {
  params: Promise<{ taskId: string }>
}

/**
 * 업무 목록의 「Omnis 와 시작」 이 확인 창을 열 때 부른다 — 첫 글(lib/task-start.ts)에 넣을 것만.
 * 목록은 업무 수백 장을 내려 주므로 배경 · 체크리스트까지 싣지 않고, 누른 한 장만 여기서 읽는다.
 * 업무 카드는 전사 공개라 로그인만 본다(GET /api/tasks/[id] 와 같다). 글(messages)은 읽지 않는다.
 */
export async function GET(_req: NextRequest, { params }: Props) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")

  const { taskId } = await params
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      slug: true,
      name: true,
      background: true,
      expectedResult: true,
      checklists: { where: { done: false }, orderBy: { createdAt: "asc" }, select: { name: true } },
    },
  })
  if (!task) return apiError(404, "업무를 찾을 수 없습니다")

  const body: TaskStartInput = {
    id: task.id,
    slug: task.slug,
    name: task.name,
    background: task.background,
    expectedResult: task.expectedResult,
    openChecklist: task.checklists.map((c) => c.name),
  }
  return NextResponse.json(body)
}
