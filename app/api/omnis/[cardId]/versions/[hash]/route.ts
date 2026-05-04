import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getVersionContent } from "@/lib/omnis-git"

export const runtime = "nodejs"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ cardId: string; hash: string }> }
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { cardId, hash } = await params
  const card = await prisma.omnisCard.findUnique({
    where: { id: cardId },
    select: { id: true, title: true },
  })
  if (!card) return NextResponse.json({ error: "not found" }, { status: 404 })

  const content = getVersionContent(card.id, card.title, hash)
  return NextResponse.json({ hash, content })
}
