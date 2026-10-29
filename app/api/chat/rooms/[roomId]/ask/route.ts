import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { apiError, parseJson } from "@/lib/api"
import { askInOmnisRoom } from "@/lib/omnis-room"
import { AskOmnisRoomSchema } from "@/lib/schemas/chat-room"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * 옴니스 1:1 방에 묻는다 — { content } 는 새 글, { retryOf } 는 답을 못 받은 내 글을 다시.
 * 실패해도 질문 글은 방에 남아 있고 응답에 함께 온다(question).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  if (!process.env.GEMINI_API_KEY) return apiError(503, "AI 기능이 비활성화되어 있습니다")

  const body = await parseJson(req)
  if (!body) return apiError(400, "잘못된 JSON 요청")
  const parsed = AskOmnisRoomSchema.safeParse(body)
  if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다")

  const { roomId } = await params
  const result = await askInOmnisRoom({ roomId, userId: session.user.id, ...parsed.data })
  if (!result.ok) {
    return NextResponse.json({ error: result.error, question: result.question ?? null }, { status: result.status })
  }
  return NextResponse.json({ messages: [result.question, result.answer] })
}
