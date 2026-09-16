// 지식 카드 쓰기 — 화면(app/api/omnis/cards)과 MCP(write_omnis_card)가 같은 길을 쓴다.
// 라우트에서 그대로 옮겼다(2026-09-16). 버전 기록 · Git 커밋 · 색인 · 활동 기록이 여기서 함께 일어난다 —
// 따로 짜면 그중 하나가 조용히 빠진다.
import { prisma } from "@/lib/db"
import { saveAndCommit, initCardFile } from "@/lib/omnis-git"
import { syncEmbeddingsSafe, deleteEmbeddingsSafe } from "@/lib/embeddings"
import { writeActivity } from "@/lib/api"
import type { Prisma } from "@/generated/prisma/client"

const WITH_CATEGORY = { category: { select: { name: true, icon: true } } } as const
export type CardRow = Prisma.OmnisCardGetPayload<{ include: typeof WITH_CATEGORY }>

export async function createOmnisCard(
  userId: string,
  input: { categoryId: string; title: string; content?: Prisma.InputJsonValue; tags?: string[] }
): Promise<CardRow> {
  const card = await prisma.$transaction(async (tx) => {
    const created = await tx.omnisCard.create({
      data: {
        categoryId: input.categoryId,
        title: input.title.trim(),
        content: input.content ?? {},
        tags: input.tags ?? [],
        updatedById: userId,
      },
      include: WITH_CATEGORY,
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

  initCardFile(card.id, card.title, JSON.stringify(input.content ?? {}, null, 2))
  await syncEmbeddingsSafe("OMNIS_CARD", card.id, userId)
  await writeActivity({
    userId, action: "omnis.created", entity: "OMNIS_CARD", entityId: card.id, title: `카드 생성: ${card.title}`,
  })
  return card
}

export async function updateOmnisCard(
  userId: string,
  input: { id: string; title?: string; content?: Prisma.InputJsonValue; tags?: string[]; categoryId?: string }
): Promise<{ error: string; code: 404 } | { card: CardRow }> {
  const existing = await prisma.omnisCard.findUnique({ where: { id: input.id } })
  if (!existing) return { error: "카드 없음", code: 404 }

  const data: Record<string, unknown> = { updatedById: userId, version: existing.version + 1 }
  if (input.title !== undefined) data.title = input.title.trim()
  if (input.content !== undefined) data.content = input.content
  if (input.tags !== undefined) data.tags = input.tags
  if (input.categoryId !== undefined) data.categoryId = input.categoryId

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } })
  const card = await prisma.$transaction(async (tx) => {
    const updated = await tx.omnisCard.update({ where: { id: input.id }, data, include: WITH_CATEGORY })
    await tx.omnisCardVersion.create({
      data: {
        cardId: input.id,
        content: (updated.content ?? {}) as Prisma.InputJsonValue,
        version: updated.version,
        createdById: userId,
      },
    })
    return updated
  })

  saveAndCommit(input.id, card.title, JSON.stringify(data.content ?? existing.content, null, 2), user?.name || "unknown")
  await syncEmbeddingsSafe("OMNIS_CARD", input.id, userId)
  await writeActivity({
    userId, action: "omnis.updated", entity: "OMNIS_CARD", entityId: input.id, title: `카드 수정: ${card.title}`,
  })
  return { card }
}

export async function deleteOmnisCard(userId: string, id: string): Promise<{ ok: true }> {
  const card = await prisma.omnisCard.findUnique({ where: { id }, select: { title: true } })
  await prisma.omnisCard.delete({ where: { id } })
  await deleteEmbeddingsSafe("OMNIS_CARD", id)
  await writeActivity({
    userId, action: "omnis.deleted", entity: "OMNIS_CARD", entityId: id, title: `카드 삭제: ${card?.title ?? id}`,
  })
  return { ok: true }
}
