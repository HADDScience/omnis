import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { apiError } from "@/lib/api"
import { listActivity } from "@/lib/activity-read"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")

  const { searchParams } = new URL(req.url)
  const entity = searchParams.get("entity") ?? undefined
  const entityId = searchParams.get("entityId") ?? undefined
  const logs = await listActivity({ entity, entityId, take: Number(searchParams.get("take") ?? 10) })
  return NextResponse.json({ success: true, logs })
}
