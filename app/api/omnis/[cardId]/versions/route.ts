import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getHistory } from "@/lib/omnis-git"

export const runtime = "nodejs"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ cardId: string }> }
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { cardId } = await params
  const card = await prisma.omnisCard.findUnique({
    where: { id: cardId },
    select: { id: true, title: true },
  })
  if (!card) return NextResponse.json({ error: "not found" }, { status: 404 })

  let history: ReturnType<typeof getHistory> = []
  try {
    history = getHistory(card.id, card.title)
  } catch {
    history = []
  }
  return NextResponse.json({ card: { id: card.id, title: card.title }, history })
}
