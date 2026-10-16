// 체크리스트 추가·수정·삭제 — 화면(app/api/tasks/[taskId]/checklists)과 MCP(update_checklist)가 같은 길을 쓴다.
// 라우트에서 그대로 옮겼다(2026-09-14). 색인과 활동 기록이 여기서 일어난다.
import { prisma } from "@/lib/db"
import { syncEmbeddingsSafe } from "@/lib/embeddings"
import { writeActivity } from "@/lib/api"
import { recordTaskEvents } from "@/lib/task-events"
import type { TaskEventVia } from "@/lib/schemas/task-event"

export async function addChecklistItem(taskId: string, name: string, userId: string, via: TaskEventVia = "web") {
  const checklist = await prisma.checklist.create({
    data: {
      name: name.trim(),
      taskId,
    },
  })
  await recordTaskEvents(taskId, userId, via, [
    { field: "checklist", before: null, after: { name: checklist.name, done: checklist.done } },
  ])

  await syncEmbeddingsSafe("TASK", taskId, userId)
  await writeActivity({
    userId,
    action: "checklist.created",
    entity: "TASK",
    entityId: taskId,
    title: `체크리스트 추가: ${checklist.name}`,
  })
  return checklist
}

export async function updateChecklistItem(
  id: string,
  input: { done?: boolean; memo?: string; name?: string },
  userId: string,
  via: TaskEventVia = "web"
) {
  const data: Record<string, unknown> = {}
  if (input.done !== undefined) data.done = input.done
  if (input.memo !== undefined) data.memo = input.memo
  if (input.name !== undefined) data.name = input.name.trim()

  const before = await prisma.checklist.findUnique({ where: { id }, select: { name: true, done: true } })
  const checklist = await prisma.checklist.update({
    where: { id },
    data,
  })
  // 메모는 이력에 넣지 않는다 — KPI 가 묻는 것은 체크 여부와 항목이다
  await recordTaskEvents(checklist.taskId, userId, via, [
    { field: "checklist", before, after: { name: checklist.name, done: checklist.done } },
  ])

  // 항목명 변경 시에만 재임베딩 발생 (done 토글은 contentHash 동일 → 무시)
  await syncEmbeddingsSafe("TASK", checklist.taskId, userId)
  await writeActivity({
    userId,
    action: "checklist.updated",
    entity: "TASK",
    entityId: checklist.taskId,
    title: `체크리스트 수정: ${checklist.name}`,
  })
  return checklist
}

export async function deleteChecklistItem(id: string, userId: string, via: TaskEventVia = "web") {
  const deleted = await prisma.checklist.delete({ where: { id } })
  await recordTaskEvents(deleted.taskId, userId, via, [
    { field: "checklist", before: { name: deleted.name, done: deleted.done }, after: null },
  ])
  await syncEmbeddingsSafe("TASK", deleted.taskId, userId)
  await writeActivity({
    userId,
    action: "checklist.deleted",
    entity: "TASK",
    entityId: deleted.taskId,
    title: `체크리스트 삭제: ${deleted.name}`,
  })
  return deleted
}
