import { prisma } from "@/lib/db"

export interface ExtractedMentions {
  taskSlugs: string[]
  userNames: string[]
}

const TASK_REGEX = /#([A-Za-z0-9가-힣_-]+)/g
const USER_REGEX = /@([A-Za-z0-9가-힣_]+)/g

export function extractMentionTokens(content: string): ExtractedMentions {
  const taskSlugs = Array.from(content.matchAll(TASK_REGEX), (m) => m[1])
  const userNames = Array.from(content.matchAll(USER_REGEX), (m) => m[1])
  return {
    taskSlugs: Array.from(new Set(taskSlugs)),
    userNames: Array.from(new Set(userNames)),
  }
}

export async function resolveMentions(content: string) {
  const { taskSlugs, userNames } = extractMentionTokens(content)

  const [tasks, users] = await Promise.all([
    taskSlugs.length > 0
      ? prisma.task.findMany({
          where: { OR: [{ slug: { in: taskSlugs } }, { name: { in: taskSlugs } }] },
          select: { id: true, slug: true, name: true },
        })
      : Promise.resolve([]),
    userNames.length > 0
      ? prisma.user.findMany({
          where: { name: { in: userNames } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ])

  return {
    taskIds: tasks.map((t) => t.id),
    userIds: users.map((u) => u.id),
    tasks,
    users,
  }
}

export async function persistMentions(messageId: string, content: string) {
  const { taskIds, userIds } = await resolveMentions(content)
  if (taskIds.length === 0 && userIds.length === 0) return

  await prisma.chatMention.createMany({
    data: [
      ...taskIds.map((taskId) => ({ messageId, type: "TASK" as const, taskId })),
      ...userIds.map((userId) => ({ messageId, type: "USER" as const, userId })),
    ],
  })
}
