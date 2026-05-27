import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getHistory, getVersionContent, getDiff, saveAndCommit } from "@/lib/omnis-git"
import { syncEmbeddingsSafe } from "@/lib/embeddings"
import { apiError, parseJson, writeActivity } from "@/lib/api"
import type { Prisma } from "@/generated/prisma/client"

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
    let content = ""
    try {
      content = getVersionContent(cardId, card.title, hash)
    } catch (err) {
      console.error("[omnis/cards/history] 버전 조회 실패", { cardId, hash, err })
      return apiError(400, "잘못된 버전 해시입니다")
    }
    if (!content) return apiError(404, "버전 내용을 찾을 수 없습니다")
    return NextResponse.json({ hash, content })
  }

  // 두 버전 diff 조회
  if (diff) {
    const [h1, h2] = diff.split("..")
    if (!h1 || !h2) return apiError(400, "diff는 hash1..hash2 형식이어야 합니다")
    let diffText = ""
    try {
      diffText = getDiff(cardId, card.title, h1, h2)
    } catch (err) {
      console.error("[omnis/cards/history] diff 조회 실패", { cardId, diff, err })
      return apiError(400, "잘못된 diff 해시입니다")
    }
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
  let restoredContent = ""
  try {
    restoredContent = getVersionContent(cardId, card.title, hash)
  } catch (err) {
    console.error("[omnis/cards/history] 복원 버전 조회 실패", { cardId, hash, err })
    return apiError(400, "잘못된 버전 해시입니다")
  }
  if (!restoredContent) return apiError(404, "복원할 버전 내용을 찾을 수 없습니다")

  let restoredJson: Prisma.InputJsonValue
  try {
    restoredJson = JSON.parse(restoredContent) as Prisma.InputJsonValue
  } catch (err) {
    console.error("[omnis/cards/history] 복원 JSON 파싱 실패", { cardId, hash, err })
    return apiError(422, "이 버전의 내용이 JSON 형식이 아니어서 복원할 수 없습니다")
  }

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

  saveAndCommit(cardId, card.title, restoredContent, userName, `${card.title} 롤백 (${hash.slice(0, 7)})`)

  await syncEmbeddingsSafe("OMNIS_CARD", cardId, userId)
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
