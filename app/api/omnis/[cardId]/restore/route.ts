import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { rollback } from "@/lib/omnis-git"
import { syncEmbeddingsSafe } from "@/lib/embeddings"
import { apiError, parseJson, writeActivity } from "@/lib/api"

export const runtime = "nodejs"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ cardId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")

  const { cardId } = await params
  const body = await parseJson<{ hash?: string }>(req)
  if (!body) return apiError(400, "잘못된 JSON 요청")
  const { hash } = body
  if (!hash) return apiError(400, "hash 필수")

  const card = await prisma.omnisCard.findUnique({
    where: { id: cardId },
    select: { id: true, title: true },
  })
  if (!card) return apiError(404, "카드 없음")

  const restoredContent = rollback(card.id, card.title, hash, session.user.name ?? "unknown")
  const restoredJson = JSON.parse(restoredContent)
  const userId = session.user.id as string

  const restoredCard = await prisma.$transaction(async (tx) => {
    const updated = await tx.omnisCard.update({
      where: { id: cardId },
      data: {
        content: restoredJson,
        version: { increment: 1 },
        updatedById: userId,
      },
    })

    await tx.omnisCardVersion.create({
      data: {
        cardId,
        content: restoredJson,
        version: updated.version,
        restoredFromHash: hash,
        createdById: userId,
      },
    })

    return updated
  })

  await syncEmbeddingsSafe("OMNIS_CARD", cardId)
  await writeActivity({
    userId,
    action: "omnis.restored",
    entity: "OMNIS_CARD",
    entityId: cardId,
    title: `카드 복원: ${card.title}`,
    metadata: { hash },
  })

  return NextResponse.json({ ok: true, content: restoredJson, version: restoredCard.version })
}
