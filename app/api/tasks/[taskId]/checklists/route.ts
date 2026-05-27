import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import { syncEmbeddingsSafe } from "@/lib/embeddings"
import { apiError, parseJson, writeActivity } from "@/lib/api"

interface Props {
  params: Promise<{ taskId: string }>
}

export async function POST(req: NextRequest, { params }: Props) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")

  const { taskId } = await params
  const body = await parseJson<{ name?: string; ownerId?: string }>(req)
  if (!body) return apiError(400, "잘못된 JSON 요청")
  const { name, ownerId } = body

  if (!name?.trim()) {
    return apiError(400, "name 필수")
  }

  const checklist = await prisma.checklist.create({
    data: {
      name: name.trim(),
      taskId,
      ownerId: ownerId || null,
    },
  })

  await syncEmbeddingsSafe("TASK", taskId, session.user.id)
  await writeActivity({
    userId: session.user.id,
    action: "checklist.created",
    entity: "TASK",
    entityId: taskId,
    title: `체크리스트 추가: ${checklist.name}`,
  })

  return NextResponse.json(checklist, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")

  const body = await parseJson<{ id?: string; done?: boolean; memo?: string; name?: string }>(req)
  if (!body) return apiError(400, "잘못된 JSON 요청")
  const { id, done, memo } = body

  if (!id) return apiError(400, "id 필수")

  const data: Record<string, unknown> = {}
  if (done !== undefined) data.done = done
  if (memo !== undefined) data.memo = memo
  if (body.name !== undefined) data.name = body.name.trim()

  const checklist = await prisma.checklist.update({
    where: { id },
    data,
  })

  // 항목명 변경 시에만 재임베딩 발생 (done 토글은 contentHash 동일 → 무시)
  await syncEmbeddingsSafe("TASK", checklist.taskId, session.user.id)
  await writeActivity({
    userId: session.user.id,
    action: "checklist.updated",
    entity: "TASK",
    entityId: checklist.taskId,
    title: `체크리스트 수정: ${checklist.name}`,
  })

  return NextResponse.json(checklist)
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")

  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")
  if (!id) return apiError(400, "id 필수")

  const deleted = await prisma.checklist.delete({ where: { id } })
  await syncEmbeddingsSafe("TASK", deleted.taskId, session.user.id)
  await writeActivity({
    userId: session.user.id,
    action: "checklist.deleted",
    entity: "TASK",
    entityId: deleted.taskId,
    title: `체크리스트 삭제: ${deleted.name}`,
  })
  return NextResponse.json({ ok: true })
}
