import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { apiError, parseJson } from "@/lib/api"
import { HandoverSessionSchema } from "@/lib/schemas/agent"
import { handover } from "@/lib/omnis-session-share"

/** 인계 — 주인을 { userId } 로. 이전 주인은 공유 참여자로 남는다(lib/omnis-session-share.ts) */
export async function POST(req: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const body = await parseJson(req)
  if (!body) return apiError(400, "잘못된 JSON 요청")
  const parsed = HandoverSessionSchema.safeParse(body)
  if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다")
  const { roomId } = await params
  const r = await handover(roomId, session.user.id, parsed.data.userId)
  if (!r.ok) return apiError(r.status, r.error)
  return NextResponse.json(r.value)
}
