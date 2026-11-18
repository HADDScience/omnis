import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import { apiError, parseJson } from "@/lib/api"
import { createOmnisCategory, deleteOmnisCategory } from "@/lib/omnis-card-ops"

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

  // 규칙은 lib/omnis-card-ops.ts(도구 manage_omnis_category 와 같다)
  const r = await createOmnisCategory(session.user.id, { name, icon })
  if (!r.ok) return apiError(r.status, r.error)
  const category = r.value
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

  const r = await deleteOmnisCategory(session.user.id, id)
  if (!r.ok) return apiError(r.status, r.error)
  return NextResponse.json({ ok: true })
}
