import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import { apiError, parseJson, writeActivity } from "@/lib/api"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return apiError(401, "인증 필요")
  }

  const { searchParams } = new URL(req.url)
  const q = searchParams.get("q")
  const sort = searchParams.get("sort")

  if (sort === "popular") {
    const cards = await prisma.omnisCard.findMany({
      orderBy: [{ viewLogs: { _count: "desc" } }, { updatedAt: "desc" }],
      include: {
        category: { select: { name: true, icon: true } },
        updatedBy: { select: { name: true } },
        _count: { select: { viewLogs: true } },
      },
    })
    return NextResponse.json(cards)
  }

  if (q) {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id
      FROM "OmnisCard"
      WHERE title ILIKE ${`%${q}%`}
        OR content::text ILIKE ${`%${q}%`}
        OR array_to_string(tags, ' ') ILIKE ${`%${q}%`}
      ORDER BY "updatedAt" DESC
      LIMIT 50
    `
    const cards = rows.length === 0 ? [] : await prisma.omnisCard.findMany({
      where: { id: { in: rows.map((row) => row.id) } },
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
    return apiError(401, "인증 필요")
  }

  const body = await parseJson<{ name?: string; icon?: string }>(req)
  if (!body) return apiError(400, "잘못된 JSON 요청")
  const { name, icon } = body

  if (!name?.trim()) {
    return apiError(400, "name 필수")
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

  await writeActivity({
    userId: session.user.id,
    action: "omnis_category.created",
    entity: "OMNIS_CATEGORY",
    entityId: category.id,
    title: `카테고리 생성: ${category.name}`,
  })

  return NextResponse.json(category, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return apiError(401, "인증 필요")
  }

  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")
  if (!id) return apiError(400, "id 필수")

  const cardCount = await prisma.omnisCard.count({ where: { categoryId: id } })
  if (cardCount > 0) {
    return apiError(400, "카드가 있는 카테고리는 삭제할 수 없습니다")
  }

  const category = await prisma.omnisCategory.delete({ where: { id } })
  await writeActivity({
    userId: session.user.id,
    action: "omnis_category.deleted",
    entity: "OMNIS_CATEGORY",
    entityId: id,
    title: `카테고리 삭제: ${category.name}`,
  })
  return NextResponse.json({ ok: true })
}
