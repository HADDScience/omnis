import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { cardVersionContent } from "@/lib/omnis-card-ops"
import { apiError } from "@/lib/api"

export const runtime = "nodejs"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ cardId: string; hash: string }> }
) {
  const session = await auth()
  if (!session?.user) return apiError(401, "인증 필요")

  const { cardId, hash } = await params
  const card = await prisma.omnisCard.findUnique({
    where: { id: cardId },
    select: { id: true, title: true },
  })
  if (!card) return apiError(404, "카드 없음")

  const v = cardVersionContent(card, hash)
  if (!v.ok) return apiError(v.status, v.error)
  return NextResponse.json({ hash, content: v.value })
}
