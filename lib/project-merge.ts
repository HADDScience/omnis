// 프로젝트 합치기 — 화면(app/api/projects/merge)과 도구(merge_projects)가 같이 부른다.
// 원본은 지우지 않고 보관한다. 업무만 대상 프로젝트로 옮긴다. 업무의 productId 는 건드리지 않는다
// (비어 있는 업무는 자연히 대상 프로젝트의 제품을 따르고, 명시된 업무는 사용자가 정한 값이다).
import { prisma } from "@/lib/db"
import { writeActivity } from "@/lib/api"

export type MergeResult =
  | { ok: true; moved: number; sourceName: string; targetName: string }
  | { ok: false; status: 400 | 404 | 409; error: string }

export async function mergeProjects(sourceId: string, targetId: string, userId: string): Promise<MergeResult> {
  if (sourceId === targetId) return { ok: false, status: 400, error: "같은 프로젝트끼리는 합칠 수 없습니다" }

  const result = await prisma.$transaction(async (tx) => {
    // 같은 두 프로젝트를 동시에 합치지 않게 — 정렬한 순서로 잠근다(교착 방지)
    const [first, second] = [sourceId, targetId].sort()
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`project-merge:${first}`}))`
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`project-merge:${second}`}))`

    const [source, target] = await Promise.all([
      tx.project.findUnique({ where: { id: sourceId }, select: { id: true, name: true, archived: true } }),
      tx.project.findUnique({ where: { id: targetId }, select: { id: true, name: true, archived: true } }),
    ])

    if (!source || !target) return { ok: false as const, reason: "notFound" as const }
    if (source.archived) return { ok: false as const, reason: "alreadyArchived" as const }
    if (target.archived) return { ok: false as const, reason: "targetArchived" as const }

    const moved = await tx.task.updateMany({ where: { projectId: sourceId }, data: { projectId: targetId } })
    await tx.project.update({ where: { id: sourceId }, data: { archived: true } })
    return { ok: true as const, moved: moved.count, sourceName: source.name, targetName: target.name }
  })

  if (!result.ok) {
    if (result.reason === "notFound") return { ok: false, status: 404, error: "프로젝트를 찾을 수 없습니다" }
    if (result.reason === "alreadyArchived") return { ok: false, status: 409, error: "이미 보관된 프로젝트입니다" }
    return { ok: false, status: 409, error: "보관된 프로젝트로는 합칠 수 없습니다" }
  }

  await writeActivity({
    userId,
    action: "project.merged",
    entity: "PROJECT",
    entityId: targetId,
    title: `프로젝트 병합: ${result.sourceName} → ${result.targetName}`,
    metadata: { sourceId, targetId, movedTasks: result.moved },
  })
  return result
}
