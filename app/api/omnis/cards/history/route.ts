import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getHistory, getVersionContent, getDiff, rollback } from "@/lib/omnis-git"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const cardId = searchParams.get("cardId")
  const hash = searchParams.get("hash")
  const diff = searchParams.get("diff")

  if (!cardId) return NextResponse.json({ error: "cardId 필수" }, { status: 400 })

  const card = await prisma.omnisCard.findUnique({ where: { id: cardId }, select: { title: true } })
  if (!card) return NextResponse.json({ error: "카드 없음" }, { status: 404 })

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
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const body = await req.json()
  const { cardId, hash } = body

  if (!cardId || !hash) {
    return NextResponse.json({ error: "cardId, hash 필수" }, { status: 400 })
  }

  const card = await prisma.omnisCard.findUnique({ where: { id: cardId } })
  if (!card) return NextResponse.json({ error: "카드 없음" }, { status: 404 })

  const userName = session.user.name || "unknown"
  const restoredContent = rollback(cardId, card.title, hash, userName)

  // DB도 업데이트
  await prisma.omnisCard.update({
    where: { id: cardId },
    data: {
      content: { text: restoredContent, status: String((card.content as Record<string, unknown>)?.status || "") },
      version: card.version + 1,
      updatedById: session.user.id,
    },
  })

  return NextResponse.json({ ok: true, content: restoredContent })
}
