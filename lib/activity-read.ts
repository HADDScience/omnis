// 활동 기록 읽기 — 화면(app/api/activity)과 도구(list_activity)가 같이 부른다.
// 로그인 · 비밀번호 · 관리자 감사 같은 사람별 보안 기록은 늘 뺀다(lib/login-guard.ts PRIVATE_ACTIVITY_ENTITIES).
import { prisma } from "@/lib/db"
import { PRIVATE_ACTIVITY_ENTITIES } from "@/lib/login-guard"

export async function listActivity(input: { entity?: string; entityId?: string; take?: number }) {
  const take = Math.min(Math.max(Number(input.take ?? 10) || 10, 1), 50)
  if (input.entity && PRIVATE_ACTIVITY_ENTITIES.includes(input.entity)) return []
  return prisma.activityLog.findMany({
    where: {
      entity: input.entity ?? { notIn: PRIVATE_ACTIVITY_ENTITIES },
      ...(input.entityId ? { entityId: input.entityId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take,
    include: { user: { select: { name: true } } },
  })
}
