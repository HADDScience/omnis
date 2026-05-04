import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import { HaddDbLanding } from "@/components/omnis/hadd-db-landing"
import { getCardVersion } from "@/lib/omnis-git"

export const dynamic = "force-dynamic"

const ONE_DAY_MS = 24 * 60 * 60 * 1000

export default async function OmnisPage() {
  const session = await auth()

  const [categories, totalCards, recent, mine] = await Promise.all([
    prisma.omnisCategory.findMany({
      orderBy: { sortOrder: "asc" },
      include: { _count: { select: { cards: true } } },
    }),
    prisma.omnisCard.count(),
    prisma.omnisCard.findMany({
      orderBy: { updatedAt: "desc" },
      take: 4,
      include: {
        category: { select: { name: true } },
        updatedBy: { select: { name: true } },
      },
    }),
    session?.user?.id
      ? prisma.omnisCard.findMany({
          where: { updatedById: session.user.id as string },
          orderBy: { updatedAt: "desc" },
          take: 4,
          include: {
            category: { select: { name: true } },
            updatedBy: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
  ])

  const withVersion = (c: (typeof recent)[number]) => {
    let version = c.version
    try {
      version = getCardVersion(c.id, c.title)
    } catch {
      /* keep db version */
    }
    return {
      id: c.id,
      title: c.title,
      categoryName: c.category?.name ?? "—",
      authorName: c.updatedBy?.name ?? null,
      updatedAt: c.updatedAt.toISOString(),
      version,
      fresh: Date.now() - c.updatedAt.getTime() < ONE_DAY_MS,
      meta: `${c.category?.name ?? "—"} · ${c.updatedBy?.name ?? "—"} · ${formatRelative(c.updatedAt)}`,
    }
  }

  const popular = [...recent].sort((a, b) => b.version - a.version).slice(0, 4)

  return (
    <HaddDbLanding
      totalCards={totalCards}
      categoryCount={categories.length}
      categories={categories.map((c) => ({ name: c.name, count: c._count.cards }))}
      recent={recent.map(withVersion)}
      popular={popular.map(withVersion)}
      mine={mine.map(withVersion)}
    />
  )
}

function formatRelative(d: Date): string {
  const diff = Date.now() - d.getTime()
  const days = Math.floor(diff / ONE_DAY_MS)
  if (days < 1) return "오늘"
  if (days === 1) return "어제"
  if (days < 7) return `${days}일 전`
  const weeks = Math.floor(days / 7)
  if (weeks < 4) return `${weeks}주 전`
  return d.toLocaleDateString("ko-KR")
}
