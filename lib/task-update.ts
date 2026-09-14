// 업무 수정 — 화면(app/api/tasks/[taskId] PATCH)과 MCP(update_task)가 같은 길을 쓴다.
//
// 라우트에서 그대로 옮겼다(2026-09-14). 완료로 바꾸면 떠 있는 완료 확인 알림을 거두는 것과
// 색인·활동 기록이 여기서 일어난다 — MCP 가 따로 짜면 그중 하나가 조용히 빠진다.
import { prisma } from "@/lib/db"
import { resolveActionsFor } from "@/lib/notifications"
import { syncEmbeddingsSafe } from "@/lib/embeddings"
import { writeActivity } from "@/lib/api"
import { proposeFromTaskSafe } from "@/lib/card-proposals"
import type { Prisma, Priority, TaskStatus } from "@/generated/prisma/client"

export interface UpdateTaskInput {
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

export const TASK_STATUSES: readonly string[] = ["TODO", "IN_PROGRESS", "REVIEW", "DONE"]

const TASK_INCLUDE = {
  assignees: { select: { user: { select: { id: true, name: true } } } },
  instructor: { select: { id: true, name: true } },
  checklists: true,
} satisfies Prisma.TaskInclude

export type UpdatedTask = Prisma.TaskGetPayload<{ include: typeof TASK_INCLUDE }>

export async function updateTask(
  taskId: string,
  userId: string,
  body: UpdateTaskInput
): Promise<{ error: string } | { task: UpdatedTask }> {
  // categoryId는 #12에서 폐기 (UI/AI 미사용). DB 컬럼은 Phase 4 drop 예정.
  const { status, name, priority, deadline, archived, background, expectedResult, projectId, productId } = body

  if (status !== undefined && !TASK_STATUSES.includes(status)) {
    return { error: `지원하지 않는 상태 값: ${status}` }
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
    include: TASK_INCLUDE,
  })

  // 담당자가 알림을 거치지 않고 상세에서 바로 완료했다면, 떠 있는 "완료로 표시할까요?"를 거둔다.
  // 그러지 않으면 이미 끝난 업무를 알림이 계속 재촉한다.
  if (status === "DONE") {
    await resolveActionsFor(taskId, "confirm_done")
    // 업무가 끝나면 그 대화에서 회사 지식을 뽑아 카드 갱신을 제안한다 (실패해도 완료는 그대로).
    // 화면과 MCP(update_task)가 모두 여기를 지난다.
    proposeFromTaskSafe(taskId, { trigger: "task_done", userId })
  }

  // archived 처리 시 syncEmbeddings가 임베딩을 삭제, 그 외에는 갱신
  await syncEmbeddingsSafe("TASK", taskId, userId)
  await writeActivity({
    userId,
    action: "task.updated",
    entity: "TASK",
    entityId: task.id,
    title: `업무 수정: ${task.name}`,
    metadata: { status: task.status },
  })

  return { task }
}
