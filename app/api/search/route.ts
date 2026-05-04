import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getCardVersion } from "@/lib/omnis-git"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

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

  const [cards, tasks, reports] = await Promise.all([
    prisma.omnisCard.findMany({
      where: { title: { contains: q, mode: "insensitive" } },
      take: 8,
      include: {
        category: { select: { name: true, icon: true } },
        updatedBy: { select: { name: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.task.findMany({
      where: { OR: [{ name: { contains: q, mode: "insensitive" } }, { slug: { contains: q, mode: "insensitive" } }] },
      take: 6,
      include: { owner: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.weeklyReport.findMany({
      where: { title: { contains: q, mode: "insensitive" } },
      take: 4,
      orderBy: { weekStart: "desc" },
    }),
  ])

  const cardsWithVersion = await Promise.all(
    cards.map(async (c) => ({
      id: c.id,
      title: c.title,
      category: c.category?.name ?? "",
      author: c.updatedBy?.name ?? "",
      updatedAt: c.updatedAt.toISOString(),
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
    elapsedMs: Date.now() - started,
  })
}
