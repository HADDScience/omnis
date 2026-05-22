import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getHistory, getVersionContent, getDiff, rollback } from "@/lib/omnis-git"
import { syncEmbeddingsSafe } from "@/lib/embeddings"
import { apiError, parseJson, writeActivity } from "@/lib/api"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return apiError(401, "인증 필요")
  }

  const { searchParams } = new URL(req.url)
  const cardId = searchParams.get("cardId")
  const hash = searchParams.get("hash")
  const diff = searchParams.get("diff")

  if (!cardId) return apiError(400, "cardId 필수")

  const card = await prisma.omnisCard.findUnique({ where: { id: cardId }, select: { title: true } })
  if (!card) return apiError(404, "카드 없음")

  // 특정 버전 내용 조회
  if (hash) {
    const content = getVersionContent(cardId, card.title, hash)
    return NextResponse.json({ hash, content })
  }

  // 두 버전 diff 조회
  if (diff) {
    const [h1, h2] = diff.split("..")
    const diffText = getDiff(cardId, card.title, h1, h2)
    return NextResponse.json({ diff: diffText })
  }

  // 버전 히스토리 목록
  const history = getHistory(cardId, card.title)
  return NextResponse.json(history)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return apiError(401, "인증 필요")
  }
  const userId = session.user.id

  const body = await parseJson<{ cardId?: string; hash?: string }>(req)
  if (!body) return apiError(400, "잘못된 JSON 요청")
  const { cardId, hash } = body

  if (!cardId || !hash) {
    return apiError(400, "cardId, hash 필수")
  }

  const card = await prisma.omnisCard.findUnique({ where: { id: cardId } })
  if (!card) return apiError(404, "카드 없음")

  const userName = session.user.name || "unknown"
  const restoredContent = rollback(cardId, card.title, hash, userName)
  const restoredJson = JSON.parse(restoredContent)

  await prisma.$transaction(async (tx) => {
    const updated = await tx.omnisCard.update({
      where: { id: cardId },
      data: {
        content: restoredJson,
        version: card.version + 1,
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

  return NextResponse.json({ ok: true, content: restoredJson })
}
