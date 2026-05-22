import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { apiError, writeActivity } from "@/lib/api"

interface Props {
  params: Promise<{ id: string }>
}

export async function DELETE(_req: NextRequest, { params }: Props) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")

  const { id } = await params
  const bookmark = await prisma.bookmark.findFirst({
    where: {
      userId: session.user.id,
      OR: [{ id }, { cardId: id }],
    },
    include: { card: { select: { id: true, title: true } } },
  })
  if (!bookmark) return apiError(404, "즐겨찾기 없음")

  await prisma.bookmark.delete({ where: { id: bookmark.id } })
  await writeActivity({
    userId: session.user.id,
    action: "bookmark.deleted",
    entity: "OMNIS_CARD",
    entityId: bookmark.card.id,
    title: `즐겨찾기 제거: ${bookmark.card.title}`,
  })

  return NextResponse.json({ success: true })
}
