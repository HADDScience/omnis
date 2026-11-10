import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { apiError, parseJson } from "@/lib/api"
import { setRoomPref } from "@/lib/chat-prefs"
import { RoomPrefSchema } from "@/lib/schemas/chat-folder"

export const runtime = "nodejs"

/**
 * 방 하나에 대한 내 설정 — { roomKey, favorite?, read?, hidden?, muted? }.
 * read: true 는 지금까지 읽은 것으로 올린다(방을 열었을 때 · 연 방에 새 글이 왔을 때 목록이 부른다).
 * muted 는 이 방의 채팅 푸시 끄기(목록 메뉴 · 밀기 칸 · 방 머리줄).
 * 남의 1:1 방 키는 없는 방과 같이 404.
 */
export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const body = await parseJson(req)
  if (!body) return apiError(400, "잘못된 JSON 요청")
  const parsed = RoomPrefSchema.safeParse(body)
  if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다")

  const result = await setRoomPref(session.user.id, parsed.data)
  if (!result.ok) return apiError(result.status, result.error)
  return NextResponse.json(result.value)
}
