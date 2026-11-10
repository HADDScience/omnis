import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { apiError, parseJson } from "@/lib/api"
import { openPeopleRoom } from "@/lib/chat-people"
import { CreatePeopleRoomSchema } from "@/lib/schemas/chat-room"

export const runtime = "nodejs"

/**
 * 「사람과 대화」 — { userIds, name? }. 1명이면 1:1(있으면 그 방을 돌려준다 · existing), 2명 이상이면 새 단톡방.
 * 구성원 누구나 만든다(작업지시자 결정 2026-10-28)
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const body = await parseJson(req)
  if (!body) return apiError(400, "잘못된 JSON 요청")
  const parsed = CreatePeopleRoomSchema.safeParse(body)
  if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다")

  const result = await openPeopleRoom({ id: session.user.id, name: session.user.name ?? "" }, parsed.data)
  if (!result.ok) return apiError(result.status, result.error)
  return NextResponse.json(result.value, { status: result.value.existing ? 200 : 201 })
}
