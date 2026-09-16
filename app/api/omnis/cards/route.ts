import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { apiError, parseJson } from "@/lib/api"
import { createOmnisCard, deleteOmnisCard, updateOmnisCard } from "@/lib/omnis-cards"
import type { Prisma } from "@/generated/prisma/client"

// 알맹이는 lib/omnis-cards 에 있다 — MCP(write_omnis_card)도 같은 함수를 부른다.

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")

  const body = await parseJson<{ categoryId?: string; title?: string; content?: Prisma.InputJsonValue; tags?: string[] }>(req)
  if (!body) return apiError(400, "잘못된 JSON 요청")
  if (!body.categoryId || !body.title?.trim()) return apiError(400, "categoryId, title 필수")

  const card = await createOmnisCard(session.user.id, {
    categoryId: body.categoryId,
    title: body.title,
    content: body.content,
    tags: body.tags,
  })
  return NextResponse.json(card, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")

  const body = await parseJson<{ id?: string; title?: string; content?: Prisma.InputJsonValue; tags?: string[]; categoryId?: string }>(req)
  if (!body) return apiError(400, "잘못된 JSON 요청")
  if (!body.id) return apiError(400, "id 필수")

  const result = await updateOmnisCard(session.user.id, { ...body, id: body.id })
  return "error" in result ? apiError(result.code, result.error) : NextResponse.json(result.card)
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")

  const id = new URL(req.url).searchParams.get("id")
  if (!id) return apiError(400, "id 필수")

  return NextResponse.json(await deleteOmnisCard(session.user.id, id))
}
