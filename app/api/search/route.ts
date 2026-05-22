import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getCardVersion } from "@/lib/omnis-git"
import { apiError } from "@/lib/api"
import { retrieveContext } from "@/lib/embeddings"

export const runtime = "nodejs"

interface CardSearchRow {
  id: string
  rank: number
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return apiError(401, "인증 필요")

  const { searchParams } = new URL(req.url)
  const q = (searchParams.get("q") ?? "").trim()

  const started = Date.now()

  if (!q) {
    return NextResponse.json({
      cards: [],
      tasks: [],
      reports: [],
      elapsedMs: Date.now() - started,
    })
  }

  const cardRows = await prisma.$queryRaw<CardSearchRow[]>`
    SELECT id,
      ts_rank_cd(
        omnis_card_search_vector(title, content, tags),
        plainto_tsquery('simple', ${q})
      ) AS rank
    FROM "OmnisCard"
    WHERE
      omnis_card_search_vector(title, content, tags) @@ plainto_tsquery('simple', ${q})
      OR title ILIKE ${`%${q}%`}
      OR content::text ILIKE ${`%${q}%`}
      OR array_to_string(tags, ' ') ILIKE ${`%${q}%`}
    ORDER BY rank DESC, "updatedAt" DESC
    LIMIT 8
  `
  const cardOrder = new Map(cardRows.map((row, i) => [row.id, i]))

  const [cards, tasks, reports, semanticChunks] = await Promise.all([
    cardRows.length > 0
      ? prisma.omnisCard.findMany({
          where: { id: { in: cardRows.map((row) => row.id) } },
          include: {
            category: { select: { name: true, icon: true } },
            updatedBy: { select: { name: true } },
            _count: { select: { viewLogs: true } },
          },
        })
      : Promise.resolve([]),
    prisma.task.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { slug: { contains: q, mode: "insensitive" } },
          { background: { contains: q, mode: "insensitive" } },
          { expectedResult: { contains: q, mode: "insensitive" } },
        ],
      },
      take: 6,
      include: { owner: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.weeklyReport.findMany({
      where: { title: { contains: q, mode: "insensitive" } },
      take: 4,
      orderBy: { weekStart: "desc" },
    }),
    process.env.GEMINI_API_KEY
      ? retrieveContext(q, { limit: 5, minSimilarity: 0.25 }).catch((err) => {
          console.error("[search] semantic retrieval failed", err)
          return []
        })
      : Promise.resolve([]),
  ])

  const cardsWithVersion = await Promise.all(
    cards
      .sort((a, b) => (cardOrder.get(a.id) ?? 999) - (cardOrder.get(b.id) ?? 999))
      .map(async (c) => ({
      id: c.id,
      title: c.title,
      category: c.category?.name ?? "",
      author: c.updatedBy?.name ?? "",
      updatedAt: c.updatedAt.toISOString(),
      viewCount: c._count.viewLogs,
      version: (() => {
        try {
          return getCardVersion(c.id, c.title)
        } catch {
          return c.version
        }
      })(),
    }))
  )

  return NextResponse.json({
    cards: cardsWithVersion,
    tasks: tasks.map((t) => ({
      id: t.id,
      slug: t.slug,
      title: t.name,
      owner: t.owner?.name ?? "",
      status: t.status,
      deadline: t.deadline?.toISOString() ?? null,
    })),
    reports: reports.map((r) => ({ id: r.id, title: r.title, weekStart: r.weekStart.toISOString() })),
    semantic: semanticChunks.map((c) => ({
      id: c.id,
      source: c.source,
      sourceId: c.sourceId,
      title: c.title,
      similarity: Math.round(c.similarity * 100),
    })),
    elapsedMs: Date.now() - started,
  })
}
