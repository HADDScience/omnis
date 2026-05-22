import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { apiError, parseJson, writeActivity } from "@/lib/api"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")

  const bookmarks = await prisma.bookmark.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: {
      card: {
        include: {
          category: { select: { name: true, icon: true } },
          updatedBy: { select: { name: true } },
          _count: { select: { viewLogs: true } },
        },
      },
    },
  })

  return NextResponse.json({ success: true, bookmarks })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")

  const body = await parseJson<{ cardId?: string }>(req)
  if (!body?.cardId) return apiError(400, "cardId 필수")

  const card = await prisma.omnisCard.findUnique({
    where: { id: body.cardId },
    select: { id: true, title: true },
  })
  if (!card) return apiError(404, "카드 없음")

  const bookmark = await prisma.bookmark.upsert({
    where: { userId_cardId: { userId: session.user.id, cardId: body.cardId } },
    update: {},
    create: { userId: session.user.id, cardId: body.cardId },
  })

  await writeActivity({
    userId: session.user.id,
    action: "bookmark.created",
    entity: "OMNIS_CARD",
    entityId: card.id,
    title: `즐겨찾기 추가: ${card.title}`,
  })

  return NextResponse.json({ success: true, bookmark }, { status: 201 })
}
