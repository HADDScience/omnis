import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import { saveAndCommit, initCardFile } from "@/lib/omnis-git"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const body = await req.json()
  const { categoryId, title, content, tags } = body

  if (!categoryId || !title?.trim()) {
    return NextResponse.json({ error: "categoryId, title 필수" }, { status: 400 })
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { name: true } })

  const card = await prisma.omnisCard.create({
    data: {
      categoryId,
      title: title.trim(),
      content: content || {},
      tags: tags || [],
      updatedById: session.user.id,
    },
    include: { category: { select: { name: true, icon: true } } },
  })

  // Git 초기 커밋 — 전체 content를 JSON으로 저장
  const contentForGit = JSON.stringify(content || {}, null, 2)
  initCardFile(card.id, card.title, contentForGit)

  return NextResponse.json(card, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const body = await req.json()
  const { id, title, content, tags, categoryId } = body

  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 })

  const existing = await prisma.omnisCard.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "카드 없음" }, { status: 404 })

  const data: Record<string, unknown> = { updatedById: session.user.id, version: existing.version + 1 }
  if (title !== undefined) data.title = title.trim()
  if (content !== undefined) data.content = content
  if (tags !== undefined) data.tags = tags
  if (categoryId !== undefined) data.categoryId = categoryId

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { name: true } })

  const card = await prisma.omnisCard.update({
    where: { id },
    data,
    include: { category: { select: { name: true, icon: true } } },
  })

  // Git 자동 커밋 — 전체 content를 JSON으로 저장
  const contentForGit = JSON.stringify(data.content ?? existing.content, null, 2)
  saveAndCommit(id, card.title, contentForGit, user?.name || "unknown")

  return NextResponse.json(card)
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 })

  await prisma.omnisCard.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
