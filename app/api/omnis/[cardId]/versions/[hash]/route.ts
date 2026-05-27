import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getVersionContent } from "@/lib/omnis-git"
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

  let content = ""
  try {
    content = getVersionContent(card.id, card.title, hash)
  } catch (err) {
    console.error("[omnis/versions] 버전 조회 실패", { cardId, hash, err })
    return apiError(400, "잘못된 버전 해시입니다")
  }
  if (!content) return apiError(404, "버전 내용을 찾을 수 없습니다")
  return NextResponse.json({ hash, content })
}
