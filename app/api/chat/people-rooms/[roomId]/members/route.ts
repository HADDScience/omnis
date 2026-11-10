import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { apiError, parseJson } from "@/lib/api"
import { invitePeople, leavePeopleRoom } from "@/lib/chat-people"
import { InvitePeopleSchema } from "@/lib/schemas/chat-room"

export const runtime = "nodejs"

type Props = { params: Promise<{ roomId: string }> }

/** 단톡방에 초대 — { userIds }. 참여자 누구나. 내보내기는 이번에 두지 않는다(작업지시자 결정 2026-10-29) */
export async function POST(req: NextRequest, { params }: Props) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const body = await parseJson(req)
  if (!body) return apiError(400, "잘못된 JSON 요청")
  const parsed = InvitePeopleSchema.safeParse(body)
  if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다")
  const { roomId } = await params
  const result = await invitePeople(roomId, session.user.id, parsed.data.userIds)
  if (!result.ok) return apiError(result.status, result.error)
  return NextResponse.json(result.value)
}

/** 단톡방 나가기 — 나 자신만. 남을 내보내는 길은 없다 */
export async function DELETE(_req: NextRequest, { params }: Props) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const { roomId } = await params
  const result = await leavePeopleRoom(roomId, session.user.id)
  if (!result.ok) return apiError(result.status, result.error)
  return NextResponse.json({ ok: true })
}
