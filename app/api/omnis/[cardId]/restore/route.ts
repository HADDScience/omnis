import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getVersionContent, saveAndCommit } from "@/lib/omnis-git"
import { syncEmbeddingsSafe } from "@/lib/embeddings"
import { apiError, parseJson, writeActivity } from "@/lib/api"
import type { Prisma } from "@/generated/prisma/client"

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

  let restoredContent = ""
  try {
    restoredContent = getVersionContent(card.id, card.title, hash)
  } catch (err) {
    console.error("[omnis/restore] 복원 버전 조회 실패", { cardId, hash, err })
    return apiError(400, "잘못된 버전 해시입니다")
  }
  if (!restoredContent) return apiError(404, "복원할 버전 내용을 찾을 수 없습니다")

  let restoredJson: Prisma.InputJsonValue
  try {
    restoredJson = JSON.parse(restoredContent) as Prisma.InputJsonValue
  } catch (err) {
    console.error("[omnis/restore] 복원 JSON 파싱 실패", { cardId, hash, err })
    return apiError(422, "이 버전의 내용이 JSON 형식이 아니어서 복원할 수 없습니다")
  }
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

  saveAndCommit(
    card.id,
    card.title,
    restoredContent,
    session.user.name ?? "unknown",
    `${card.title} 롤백 (${hash.slice(0, 7)})`
  )

  await syncEmbeddingsSafe("OMNIS_CARD", cardId, userId)
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
