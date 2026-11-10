import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { apiError, parseJson } from "@/lib/api"
import { createFolder, listFolders, reorderFolders } from "@/lib/chat-prefs"
import { CreateFolderSchema, ReorderFoldersSchema } from "@/lib/schemas/chat-folder"

export const runtime = "nodejs"

/** 내 채팅방 폴더(순서대로). 폴더는 개인 설정이라 남의 것은 오지 않는다 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  return NextResponse.json({ folders: await listFolders(session.user.id) })
}

/** 폴더 만들기 — { name } 은 수동 폴더, { rule } 은 추천(규칙) 폴더. 규칙 폴더는 종류마다 하나 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const body = await parseJson(req)
  if (!body) return apiError(400, "잘못된 JSON 요청")
  const parsed = CreateFolderSchema.safeParse(body)
  if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다")

  const result = await createFolder(session.user.id, parsed.data)
  if (!result.ok) return apiError(result.status, result.error)
  return NextResponse.json(result.value, { status: 201 })
}

/** 순서 바꾸기 — { order: [내 폴더 id 전부] } */
export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const body = await parseJson(req)
  if (!body) return apiError(400, "잘못된 JSON 요청")
  const parsed = ReorderFoldersSchema.safeParse(body)
  if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다")

  const result = await reorderFolders(session.user.id, parsed.data.order)
  if (!result.ok) return apiError(result.status, result.error)
  return NextResponse.json({ ok: true })
}
