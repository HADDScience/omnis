import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import { saveAndCommit, initCardFile } from "@/lib/omnis-git"
import { syncEmbeddingsSafe, deleteEmbeddingsSafe } from "@/lib/embeddings"
import type { Prisma } from "@/generated/prisma/client"
import { apiError, parseJson, writeActivity } from "@/lib/api"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return apiError(401, "인증 필요")
  }
  const userId = session.user.id

  const body = await parseJson<{ categoryId?: string; title?: string; content?: Prisma.InputJsonValue; tags?: string[] }>(req)
  if (!body) {
    return apiError(400, "잘못된 JSON 요청")
  }
  const { categoryId, title, content, tags } = body

  if (!categoryId || !title?.trim()) {
    return apiError(400, "categoryId, title 필수")
  }

  const card = await prisma.$transaction(async (tx) => {
    const created = await tx.omnisCard.create({
      data: {
        categoryId,
        title: title.trim(),
        content: content || {},
        tags: tags || [],
        updatedById: userId,
      },
      include: { category: { select: { name: true, icon: true } } },
    })

    await tx.omnisCardVersion.create({
      data: {
        cardId: created.id,
        content: (created.content ?? {}) as Prisma.InputJsonValue,
        version: created.version,
        createdById: userId,
      },
    })

    return created
  })

  // Git 초기 커밋 — 전체 content를 JSON으로 저장
  const contentForGit = JSON.stringify(content || {}, null, 2)
  initCardFile(card.id, card.title, contentForGit)

  await syncEmbeddingsSafe("OMNIS_CARD", card.id, userId)
  await writeActivity({
    userId,
    action: "omnis.created",
    entity: "OMNIS_CARD",
    entityId: card.id,
    title: `카드 생성: ${card.title}`,
  })

  return NextResponse.json(card, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return apiError(401, "인증 필요")
  }
  const userId = session.user.id

  const body = await parseJson<{ id?: string; title?: string; content?: Prisma.InputJsonValue; tags?: string[]; categoryId?: string }>(req)
  if (!body) {
    return apiError(400, "잘못된 JSON 요청")
  }
  const { id, title, content, tags, categoryId } = body

  if (!id) return apiError(400, "id 필수")

  const existing = await prisma.omnisCard.findUnique({ where: { id } })
  if (!existing) return apiError(404, "카드 없음")

  const data: Record<string, unknown> = { updatedById: userId, version: existing.version + 1 }
  if (title !== undefined) data.title = title.trim()
  if (content !== undefined) data.content = content
  if (tags !== undefined) data.tags = tags
  if (categoryId !== undefined) data.categoryId = categoryId

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } })

  const card = await prisma.$transaction(async (tx) => {
    const updated = await tx.omnisCard.update({
      where: { id },
      data,
      include: { category: { select: { name: true, icon: true } } },
    })

    await tx.omnisCardVersion.create({
      data: {
        cardId: id,
        content: (updated.content ?? {}) as Prisma.InputJsonValue,
        version: updated.version,
        createdById: userId,
      },
    })

    return updated
  })

  // Git 자동 커밋 — 전체 content를 JSON으로 저장
  const contentForGit = JSON.stringify(data.content ?? existing.content, null, 2)
  saveAndCommit(id, card.title, contentForGit, user?.name || "unknown")

  await syncEmbeddingsSafe("OMNIS_CARD", id, userId)
  await writeActivity({
    userId,
    action: "omnis.updated",
    entity: "OMNIS_CARD",
    entityId: id,
    title: `카드 수정: ${card.title}`,
  })

  return NextResponse.json(card)
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return apiError(401, "인증 필요")
  }

  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")
  if (!id) return apiError(400, "id 필수")

  const card = await prisma.omnisCard.findUnique({ where: { id }, select: { title: true } })
  await prisma.omnisCard.delete({ where: { id } })
  await deleteEmbeddingsSafe("OMNIS_CARD", id)
  await writeActivity({
    userId: session.user.id,
    action: "omnis.deleted",
    entity: "OMNIS_CARD",
    entityId: id,
    title: `카드 삭제: ${card?.title ?? id}`,
  })
  return NextResponse.json({ ok: true })
}
