import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { apiError, parseJson } from "@/lib/api"
import { loadPeopleRoom, renamePeopleRoom } from "@/lib/chat-people"
import { RenamePeopleRoomSchema } from "@/lib/schemas/chat-room"

export const runtime = "nodejs"

type Props = { params: Promise<{ roomId: string }> }

/** 방 정보 · 참여자. 참여자가 아니면 없는 방과 같은 404 */
export async function GET(_req: NextRequest, { params }: Props) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const { roomId } = await params
  const room = await loadPeopleRoom(roomId, session.user.id)
  if (!room) return apiError(404, "방을 찾을 수 없습니다")
  return NextResponse.json(room)
}

/** 단톡방 이름 바꾸기 — { name } */
export async function PATCH(req: NextRequest, { params }: Props) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const body = await parseJson(req)
  if (!body) return apiError(400, "잘못된 JSON 요청")
  const parsed = RenamePeopleRoomSchema.safeParse(body)
  if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다")
  const { roomId } = await params
  const result = await renamePeopleRoom(roomId, session.user.id, parsed.data.name)
  if (!result.ok) return apiError(result.status, result.error)
  return NextResponse.json({ ok: true })
}
