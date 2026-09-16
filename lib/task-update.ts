// 업무 수정 — 화면(app/api/tasks/[taskId] PATCH)과 MCP(update_task)가 같은 길을 쓴다.
//
// 라우트에서 그대로 옮겼다(2026-09-14). 완료로 바꾸면 떠 있는 완료 확인 알림을 거두는 것과
// 색인·활동 기록이 여기서 일어난다 — MCP 가 따로 짜면 그중 하나가 조용히 빠진다.
import { prisma } from "@/lib/db"
import { createNotification, resolveActionsFor } from "@/lib/notifications"
import { SYSTEM_USER_ID } from "@/lib/system-user"
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
  /** 담당자 전체 교체. 생성 때만 정해지던 값이라 틀리면 DB 를 직접 고쳐야 했다(2026-09-16). */
  assigneeIds?: string[]
  instructorId?: string
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
  const { status, name, priority, deadline, archived, background, expectedResult, projectId, productId, assigneeIds, instructorId } = body

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

  // 사람 바꾸기 — 지시자와 담당자를 반대로 넣어도 고칠 길이 없었다(2026-09-16).
  // 담당자는 통째로 갈아끼운다. 부분 추가·삭제를 따로 두면 화면이 두 가지 요청을 조립해야 한다.
  let nextAssigneeIds: string[] = []
  let previousAssigneeIds: string[] = []
  if (assigneeIds !== undefined || instructorId !== undefined) {
    const before = await prisma.task.findUnique({
      where: { id: taskId },
      select: { assignees: { select: { userId: true } } },
    })
    if (!before) return { error: "업무를 찾을 수 없습니다" }
    previousAssigneeIds = before.assignees.map((a) => a.userId)
  }

  if (assigneeIds !== undefined) {
    // 🤖 시스템 계정은 사람이 아니다 — 담당자 후보에서 뺀다(구조화 AI 와 같은 규칙).
    nextAssigneeIds = [...new Set(assigneeIds)].filter((id) => id !== SYSTEM_USER_ID)
    if (nextAssigneeIds.length === 0) return { error: "담당자는 최소 1명이 필요합니다" }
    const found = await prisma.user.count({ where: { id: { in: nextAssigneeIds } } })
    if (found !== nextAssigneeIds.length) return { error: "담당자 중에 없는 사용자가 있습니다" }
    data.assignees = { deleteMany: {}, create: nextAssigneeIds.map((userId) => ({ userId })) }
  }

  if (instructorId !== undefined) {
    if (instructorId === SYSTEM_USER_ID) return { error: "시스템 계정은 지시자가 될 수 없습니다" }
    const found = await prisma.user.count({ where: { id: instructorId } })
    if (found === 0) return { error: "없는 사용자를 지시자로 지정했습니다" }
    data.instructorId = instructorId
  }

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

  // 새로 담당이 된 사람에게만 알린다 — 빠진 사람에게 "당신은 빠졌다"를 보내지 않는다.
  // 생성 때와 같은 accept_task 알림이라, 받은 사람이 수락할 때까지 남는다.
  if (assigneeIds !== undefined) {
    const added = nextAssigneeIds.filter((id) => !previousAssigneeIds.includes(id) && id !== userId)
    if (added.length > 0) {
      const actor = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } })
      for (const id of added) {
        await createNotification(
          id,
          "task_assigned",
          `새 업무: ${task.name}`,
          `${actor?.name ?? "누군가"}님이 담당자로 지정했습니다.`,
          task.id,
          "accept_task"
        )
      }
    }
  }

  // archived 처리 시 syncEmbeddings가 임베딩을 삭제, 그 외에는 갱신
  await syncEmbeddingsSafe("TASK", taskId, userId)
  await writeActivity({
    userId,
    action: "task.updated",
    entity: "TASK",
    entityId: task.id,
    title: `업무 수정: ${task.name}`,
    metadata: {
      status: task.status,
      // 사람이 바뀐 것은 나중에 "누가 언제 바꿨나"를 묻게 된다 — 기록에 남긴다
      ...(assigneeIds !== undefined ? { assigneeIds: nextAssigneeIds } : {}),
      ...(instructorId !== undefined ? { instructorId } : {}),
    },
  })

  return { task }
}
