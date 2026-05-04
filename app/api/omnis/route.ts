import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get("q")

  if (q) {
    const cards = await prisma.omnisCard.findMany({
      where: {
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { tags: { has: q } },
        ],
      },
      include: { category: { select: { name: true, icon: true } } },
      orderBy: { updatedAt: "desc" },
    })
    return NextResponse.json(cards)
  }

  const categories = await prisma.omnisCategory.findMany({
    orderBy: { sortOrder: "asc" },
    include: {
      cards: {
        orderBy: { updatedAt: "desc" },
        include: { updatedBy: { select: { name: true } } },
      },
    },
  })
  return NextResponse.json(categories)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const body = await req.json()
  const { name, icon } = body

  if (!name?.trim()) {
    return NextResponse.json({ error: "name 필수" }, { status: 400 })
  }

  const maxSort = await prisma.omnisCategory.aggregate({ _max: { sortOrder: true } })
  const nextSort = (maxSort._max.sortOrder ?? 0) + 1

  const category = await prisma.omnisCategory.create({
    data: {
      name: name.trim(),
      icon: icon || "📁",
      sortOrder: nextSort,
    },
  })

  return NextResponse.json(category, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 })

  const cardCount = await prisma.omnisCard.count({ where: { categoryId: id } })
  if (cardCount > 0) {
    return NextResponse.json({ error: "카드가 있는 카테고리는 삭제할 수 없습니다" }, { status: 400 })
  }

  await prisma.omnisCategory.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
