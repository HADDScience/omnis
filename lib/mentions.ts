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

/**
 * 고친 글의 멘션을 **갈아끼운다** (2026-09-16).
 *
 * `persistMentions` 는 보낼 때 한 번 쓰는 함수라 더하기만 한다. 고칠 때 그것을 쓰면
 * 옛 멘션이 남아 「#A 를 #B 로 바꿨는데 스레드 라우팅은 여전히 A 를 가리키는」 상태가 된다.
 */
export async function replaceMentions(messageId: string, content: string) {
  const { taskIds } = await resolveMentions(content)
  await prisma.chatMention.deleteMany({ where: { messageId } })
  if (taskIds.length === 0) return
  await prisma.chatMention.createMany({
    data: taskIds.map((taskId) => ({ messageId, type: "TASK" as const, taskId })),
  })
}
