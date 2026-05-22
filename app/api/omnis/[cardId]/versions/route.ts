import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getHistory } from "@/lib/omnis-git"
import { apiError } from "@/lib/api"

export const runtime = "nodejs"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ cardId: string }> }
) {
  const session = await auth()
  if (!session?.user) return apiError(401, "인증 필요")

  const { cardId } = await params
  const card = await prisma.omnisCard.findUnique({
    where: { id: cardId },
    select: { id: true, title: true },
  })
  if (!card) return apiError(404, "카드 없음")

  let history: ReturnType<typeof getHistory> = []
  try {
    history = getHistory(card.id, card.title)
  } catch {
    history = []
  }
  return NextResponse.json({ card: { id: card.id, title: card.title }, history })
}
