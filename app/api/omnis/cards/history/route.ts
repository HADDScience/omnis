import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getHistory, getDiff } from "@/lib/omnis-git"
import { apiError, parseJson } from "@/lib/api"
import { cardVersionContent, restoreOmnisCard } from "@/lib/omnis-card-ops"

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
    const v = cardVersionContent({ id: cardId, title: card.title }, hash)
    if (!v.ok) return apiError(v.status, v.error)
    return NextResponse.json({ hash, content: v.value })
  }

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

  // 복원 규칙은 lib/omnis-card-ops.ts restoreOmnisCard — omnis/[cardId]/restore · 도구 restore_omnis_card 와 같다
  const r = await restoreOmnisCard({ id: userId, name: session.user.name }, cardId, hash)
  if (!r.ok) return apiError(r.status, r.error)
  return NextResponse.json({ ok: true, content: r.value.content })
}
