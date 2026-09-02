import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { resolveActionsFor } from "@/lib/notifications"
import { auth } from "@/lib/auth"
import { syncEmbeddingsSafe, deleteEmbeddingsSafe } from "@/lib/embeddings"
import { apiError, parseJson, writeActivity } from "@/lib/api"
import type { Prisma, Priority, TaskStatus } from "@/generated/prisma/client"

interface Props {
  params: Promise<{ taskId: string }>
}

interface UpdateTaskBody {
  status?: TaskStatus
  name?: string
  priority?: Priority
  deadline?: string | null
  archived?: boolean
  background?: string | null
  expectedResult?: string | null
  projectId?: string | null
  productId?: string | null
  workStart?: string
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
      owner: { select: { id: true, name: true } },
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
  const body = await parseJson<UpdateTaskBody>(req)
  if (!body) return apiError(400, "잘못된 JSON 요청")
  // categoryId는 #12에서 폐기 (UI/AI 미사용). DB 컬럼은 Phase 4 drop 예정.
  const { status, name, priority, deadline, archived, background, expectedResult, projectId, productId } = body

  const ALLOWED_STATUS = new Set(["TODO", "IN_PROGRESS", "REVIEW", "DONE"])
  if (status !== undefined && !ALLOWED_STATUS.has(status)) {
    return apiError(400, `지원하지 않는 상태 값: ${status}`)
  }

  const data: Prisma.TaskUncheckedUpdateInput = {}
  if (status !== undefined) data.status = status
  if (name !== undefined) data.name = name
  if (priority !== undefined) data.priority = priority
  if (deadline !== undefined) data.deadline = deadline ? new Date(deadline) : null
  if (archived !== undefined) data.archived = archived
  if (background !== undefined) data.background = background
  if (expectedResult !== undefined) data.expectedResult = expectedResult
  if (projectId !== undefined) data.projectId = projectId
  if (productId !== undefined) data.productId = productId

  // 완료 시 workEnd 설정
  if (status === "DONE") data.workEnd = new Date()
  if (status === "IN_PROGRESS" && !body.workStart) data.workStart = new Date()

  const task = await prisma.task.update({
    where: { id: taskId },
    data,
    include: {
      owner: { select: { id: true, name: true } },
      instructor: { select: { id: true, name: true } },
      checklists: true,
    },
  })

  // 담당자가 알림을 거치지 않고 상세에서 바로 완료했다면, 떠 있는 "완료로 표시할까요?"를 거둔다.
  // 그러지 않으면 이미 끝난 업무를 알림이 계속 재촉한다.
  if (status === "DONE") {
    await resolveActionsFor(taskId, "confirm_done")
  }

  // archived 처리 시 syncEmbeddings가 임베딩을 삭제, 그 외에는 갱신
  await syncEmbeddingsSafe("TASK", taskId, session.user.id)
  await writeActivity({
    userId: session.user.id,
    action: "task.updated",
    entity: "TASK",
    entityId: task.id,
    title: `업무 수정: ${task.name}`,
    metadata: { status: task.status },
  })

  return NextResponse.json(task)
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
