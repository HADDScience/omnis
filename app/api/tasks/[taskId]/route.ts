import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import { deleteEmbeddingsSafe } from "@/lib/embeddings"
import { apiError, parseJson, writeActivity } from "@/lib/api"
import { updateTask, type UpdateTaskInput } from "@/lib/task-update"

interface Props {
  params: Promise<{ taskId: string }>
}

export async function GET(_req: NextRequest, { params }: Props) {
  const session = await auth()
  if (!session?.user?.id) {
    return apiError(401, "인증 필요")
  }

  const { taskId } = await params
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      assignees: { select: { user: { select: { id: true, name: true } } } },
      instructor: { select: { id: true, name: true } },
      checklists: { orderBy: { createdAt: "asc" } },
      messages: {
        orderBy: { createdAt: "asc" },
        include: { author: { select: { id: true, name: true } } },
      },
      project: {
        select: {
          id: true,
          name: true,
          product: { select: { id: true, name: true, color: true } },
        },
      },
    },
  })

  if (!task) return apiError(404, "업무를 찾을 수 없습니다")
  return NextResponse.json(task)
}

export async function PATCH(req: NextRequest, { params }: Props) {
  const session = await auth()
  if (!session?.user?.id) {
    return apiError(401, "인증 필요")
  }

  const { taskId } = await params
  const body = await parseJson<UpdateTaskInput>(req)
  if (!body) return apiError(400, "잘못된 JSON 요청")

  const userId = session.user.id
  if (!userId) return apiError(401, "인증 필요")

  // 알맹이는 lib/task-update 에 있다 — MCP(update_task)도 같은 함수를 부른다.
  const result = await updateTask(taskId, userId, body)
  if ("error" in result) return apiError(400, result.error)
  return NextResponse.json(result.task)
}

export async function DELETE(_req: NextRequest, { params }: Props) {
  const session = await auth()
  if (!session?.user?.id) {
    return apiError(401, "인증 필요")
  }

  const { taskId } = await params

  const task = await prisma.task.update({
    where: { id: taskId },
    data: { archived: true },
  })
  await deleteEmbeddingsSafe("TASK", taskId)
  await writeActivity({
    userId: session.user.id,
    action: "task.archived",
    entity: "TASK",
    entityId: taskId,
    title: `업무 보관: ${task.name}`,
  })

  return NextResponse.json({ ok: true })
}
