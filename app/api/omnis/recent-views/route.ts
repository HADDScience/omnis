import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { apiError } from "@/lib/api"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")

  const { searchParams } = new URL(req.url)
  const take = Math.min(Math.max(Number(searchParams.get("take") ?? 6), 1), 20)

  const rows = await prisma.omnisViewLog.findMany({
    where: { userId: session.user.id },
    distinct: ["cardId"],
    orderBy: { viewedAt: "desc" },
    take,
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

  return NextResponse.json({
    success: true,
    cards: rows.map((row) => ({
      ...row.card,
      viewedAt: row.viewedAt,
      viewCount: row.card._count.viewLogs,
    })),
  })
}
