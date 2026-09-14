import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { apiError, parseJson } from "@/lib/api"
import { addChecklistItem, deleteChecklistItem, updateChecklistItem } from "@/lib/checklists"

interface Props {
  params: Promise<{ taskId: string }>
}

export async function POST(req: NextRequest, { params }: Props) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")

  const { taskId } = await params
  const body = await parseJson<{ name?: string }>(req)
  if (!body) return apiError(400, "잘못된 JSON 요청")
  const { name } = body

  if (!name?.trim()) {
    return apiError(400, "name 필수")
  }

  // 알맹이는 lib/checklists 에 있다 — MCP(update_checklist)도 같은 함수를 부른다.
  const checklist = await addChecklistItem(taskId, name, session.user.id)
  return NextResponse.json(checklist, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")

  const body = await parseJson<{ id?: string; done?: boolean; memo?: string; name?: string }>(req)
  if (!body) return apiError(400, "잘못된 JSON 요청")
  const { id, done, memo, name } = body

  if (!id) return apiError(400, "id 필수")

  const checklist = await updateChecklistItem(id, { done, memo, name }, session.user.id)
  return NextResponse.json(checklist)
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")

  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")
  if (!id) return apiError(400, "id 필수")

  await deleteChecklistItem(id, session.user.id)
  return NextResponse.json({ ok: true })
}
