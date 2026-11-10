import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { apiError, parseJson } from "@/lib/api"
import { deleteFolder, renameFolder } from "@/lib/chat-prefs"
import { RenameFolderSchema } from "@/lib/schemas/chat-folder"

export const runtime = "nodejs"

type Ctx = { params: Promise<{ folderId: string }> }

/** 이름 바꾸기 — 내 폴더만. 남의 폴더 id 는 404 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const body = await parseJson(req)
  if (!body) return apiError(400, "잘못된 JSON 요청")
  const parsed = RenameFolderSchema.safeParse(body)
  if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다")

  const { folderId } = await params
  const result = await renameFolder(session.user.id, folderId, parsed.data.name)
  if (!result.ok) return apiError(result.status, result.error)
  return NextResponse.json({ ok: true })
}

/** 지우기 — 폴더만 지운다. 안에 넣은 방은 그대로다 */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const { folderId } = await params
  const result = await deleteFolder(session.user.id, folderId)
  if (!result.ok) return apiError(result.status, result.error)
  return NextResponse.json({ ok: true })
}
