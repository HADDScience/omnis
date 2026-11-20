import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { apiError } from "@/lib/api"
import { removeBookmark } from "@/lib/omnis-card-ops"

interface Props {
  params: Promise<{ id: string }>
}

/** 즐겨찾기 빼기 — 즐겨찾기 ID 또는 카드 ID, 내 것만(lib/omnis-card-ops.ts) */
export async function DELETE(_req: NextRequest, { params }: Props) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const { id } = await params
  const r = await removeBookmark(session.user.id, id)
  if (!r.ok) return apiError(r.status, r.error)
  return NextResponse.json({ success: true })
}
