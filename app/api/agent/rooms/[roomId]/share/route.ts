import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { apiError, parseJson } from "@/lib/api"
import { ShareSessionSchema, UnshareSessionSchema } from "@/lib/schemas/agent"
import { shareState, shareWithPeople, shareWithRoom, unshare } from "@/lib/omnis-session-share"

// 옴니스 세션 공유(lib/omnis-session-share.ts). 참여자가 아니면 404, 주인이 아니면 공유 · 해제는 403

type Props = { params: Promise<{ roomId: string }> }

/** 공유 상태 — 주인 · 사람 공유 · 방 공유. 참여자면 누구나 본다 */
export async function GET(_req: NextRequest, { params }: Props) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const { roomId } = await params
  const r = await shareState(roomId, session.user.id)
  if (!r.ok) return apiError(r.status, r.error)
  return NextResponse.json(r.value, { headers: { "Cache-Control": "no-store" } })
}

/** 공유 — { userIds } 사람들, { roomId } 방 하나 */
export async function POST(req: NextRequest, { params }: Props) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const body = await parseJson(req)
  if (!body) return apiError(400, "잘못된 JSON 요청")
  const parsed = ShareSessionSchema.safeParse(body)
  if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다")
  const { roomId } = await params
  const r = "userIds" in parsed.data
    ? await shareWithPeople(roomId, session.user.id, parsed.data.userIds)
    : await shareWithRoom(roomId, session.user.id, parsed.data.roomId)
  if (!r.ok) return apiError(r.status, r.error)
  return NextResponse.json(r.value)
}

/** 공유 해제 — { userId } 한 사람, { room: true } 방 공유, { all: true } 모두 */
export async function DELETE(req: NextRequest, { params }: Props) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const body = await parseJson(req)
  if (!body) return apiError(400, "잘못된 JSON 요청")
  const parsed = UnshareSessionSchema.safeParse(body)
  if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다")
  const { roomId } = await params
  const r = await unshare(roomId, session.user.id, parsed.data)
  if (!r.ok) return apiError(r.status, r.error)
  return NextResponse.json(r.value)
}
