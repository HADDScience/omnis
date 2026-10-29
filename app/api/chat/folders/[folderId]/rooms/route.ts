import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { apiError, parseJson } from "@/lib/api"
import { addRoomToFolder, removeRoomFromFolder } from "@/lib/chat-prefs"
import { FolderRoomSchema } from "@/lib/schemas/chat-folder"

export const runtime = "nodejs"

type Ctx = { params: Promise<{ folderId: string }> }

/** 수동 폴더에 방 넣기 — { roomKey }. 남의 1:1 방 · 없는 방은 404, 추천(규칙) 폴더는 400 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const body = await parseJson(req)
  if (!body) return apiError(400, "잘못된 JSON 요청")
  const parsed = FolderRoomSchema.safeParse(body)
  if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다")

  const { folderId } = await params
  const result = await addRoomToFolder(session.user.id, folderId, parsed.data.roomKey)
  if (!result.ok) return apiError(result.status, result.error)
  return NextResponse.json({ ok: true }, { status: 201 })
}

/** 폴더에서 방 빼기 — ?roomKey= */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const parsed = FolderRoomSchema.safeParse({ roomKey: req.nextUrl.searchParams.get("roomKey") })
  if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다")

  const { folderId } = await params
  const result = await removeRoomFromFolder(session.user.id, folderId, parsed.data.roomKey)
  if (!result.ok) return apiError(result.status, result.error)
  return NextResponse.json({ ok: true })
}
