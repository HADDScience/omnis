import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { apiError } from "@/lib/api"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")

  const { searchParams } = new URL(req.url)
  const entity = searchParams.get("entity") ?? undefined
  const entityId = searchParams.get("entityId") ?? undefined
  const take = Math.min(Math.max(Number(searchParams.get("take") ?? 10), 1), 50)

  const logs = await prisma.activityLog.findMany({
    where: {
      ...(entity ? { entity } : {}),
      ...(entityId ? { entityId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take,
    include: { user: { select: { name: true } } },
  })

  return NextResponse.json({ success: true, logs })
}
