import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import { apiError, parseJson, writeActivity } from "@/lib/api"

interface MergeBody {
  sourceId?: string
  targetId?: string
}

/**
 * 프로젝트 병합.
 *
 * 이름 정규화로는 "홈페이지 관리"와 "웹사이트 관리"를 같은 것으로 볼 수 없다
 * (실측: 프로젝트명 178종 중 71%가 자동 병합 불가 — 인수인계 §5-B-4).
 * 기계가 판단할 수 없는 나머지를 사람이 사후에 합치는 자리다.
 *
 * 원본은 지우지 않고 보관(archived) 처리한다. 업무만 대상 프로젝트로 옮긴다.
 * 업무의 `productId`는 건드리지 않는다 — 비어 있는 업무는 자연히 대상 프로젝트의
 * 제품을 따르고, 명시된 업무는 사용자가 정한 값이므로 유지된다.
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return apiError(401, "인증 필요")
  }

  const body = await parseJson<MergeBody>(req)
  if (!body) return apiError(400, "잘못된 JSON 요청")

  const sourceId = body.sourceId?.trim()
  const targetId = body.targetId?.trim()
  if (!sourceId || !targetId) {
    return apiError(400, "sourceId, targetId 필수")
  }
  if (sourceId === targetId) {
    return apiError(400, "같은 프로젝트끼리는 합칠 수 없습니다")
  }

  const result = await prisma.$transaction(async (tx) => {
    // 두 프로젝트를 항상 같은 순서로 잠근다.
    // A→B 와 B→A 가 동시에 들어올 때 서로의 잠금을 기다리며 교착되는 것을 막는다.
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

    const moved = await tx.task.updateMany({
      where: { projectId: sourceId },
      data: { projectId: targetId },
    })
    await tx.project.update({ where: { id: sourceId }, data: { archived: true } })

    return {
      ok: true as const,
      moved: moved.count,
      sourceName: source.name,
      targetName: target.name,
    }
  })

  if (!result.ok) {
    if (result.reason === "notFound") return apiError(404, "프로젝트를 찾을 수 없습니다")
    if (result.reason === "alreadyArchived") return apiError(409, "이미 보관된 프로젝트입니다")
    return apiError(409, "보관된 프로젝트로는 합칠 수 없습니다")
  }

  await writeActivity({
    userId: session.user.id,
    action: "project.merged",
    entity: "PROJECT",
    entityId: targetId,
    title: `프로젝트 병합: ${result.sourceName} → ${result.targetName}`,
    metadata: { sourceId, targetId, movedTasks: result.moved },
  })

  return NextResponse.json(result)
}
