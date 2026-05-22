import { prisma } from "@/lib/db"

export interface ExtractedMentions {
  taskSlugs: string[]
}

const TASK_REGEX = /#([A-Za-z0-9가-힣_-]+)/g

export function extractMentionTokens(content: string): ExtractedMentions {
  const taskSlugs = Array.from(content.matchAll(TASK_REGEX), (m) => m[1])
  return {
    taskSlugs: Array.from(new Set(taskSlugs)),
  }
}

export async function resolveMentions(content: string) {
  const { taskSlugs } = extractMentionTokens(content)

  const tasks = taskSlugs.length > 0
    ? await prisma.task.findMany({
        where: { OR: [{ slug: { in: taskSlugs } }, { name: { in: taskSlugs } }] },
        select: { id: true, slug: true, name: true },
      })
    : []

  return {
    taskIds: tasks.map((t) => t.id),
    tasks,
  }
}

export async function persistMentions(messageId: string, content: string) {
  const { taskIds } = await resolveMentions(content)
  if (taskIds.length === 0) return

  await prisma.chatMention.createMany({
    data: taskIds.map((taskId) => ({ messageId, type: "TASK" as const, taskId })),
  })
}
