import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { apiError, parseJson } from "@/lib/api"
import { addBookmark, listBookmarks } from "@/lib/omnis-card-ops"

/** 내 즐겨찾기 — 규칙은 lib/omnis-card-ops.ts(도구 manage_bookmarks 와 같다) */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  return NextResponse.json({ success: true, bookmarks: await listBookmarks(session.user.id) })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const body = await parseJson<{ cardId?: string }>(req)
  if (!body?.cardId) return apiError(400, "cardId 필수")
  const r = await addBookmark(session.user.id, body.cardId)
  if (!r.ok) return apiError(r.status, r.error)
  return NextResponse.json({ success: true, bookmark: r.value }, { status: 201 })
}
