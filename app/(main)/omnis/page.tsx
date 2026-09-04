import { Header } from "@/components/layout/header"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import { HaddDbLanding } from "@/components/omnis/hadd-db-landing"
import { CreateCardDialog } from "@/components/omnis/create-card-dialog"
import { getCardVersion } from "@/lib/omnis-git"

export const dynamic = "force-dynamic"

const ONE_DAY_MS = 24 * 60 * 60 * 1000

interface Props {
  searchParams: Promise<{ filter?: string }>
}

export default async function OmnisPage({ searchParams }: Props) {
  const session = await auth()
  const { filter } = await searchParams
  const activeFilter = filter === "bookmarks" ? "bookmarks" : "all"
  const now = Date.now()

  const userId = session?.user?.id as string | undefined

  const [categories, totalCards, recent, popular, mine, bookmarks, recentViews, activityLogs] = await Promise.all([
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
        _count: { select: { viewLogs: true } },
      },
    }),
    prisma.omnisCard.findMany({
      orderBy: [{ viewLogs: { _count: "desc" } }, { updatedAt: "desc" }],
      take: 4,
      include: {
        category: { select: { name: true } },
        updatedBy: { select: { name: true } },
        _count: { select: { viewLogs: true } },
      },
    }),
    userId
      ? prisma.omnisCard.findMany({
          where: { updatedById: userId },
          orderBy: { updatedAt: "desc" },
          take: 4,
          include: {
            category: { select: { name: true } },
            updatedBy: { select: { name: true } },
            _count: { select: { viewLogs: true } },
          },
        })
      : Promise.resolve([]),
    userId
      ? prisma.bookmark.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          take: 8,
          include: {
            card: {
              include: {
                category: { select: { name: true } },
                updatedBy: { select: { name: true } },
                _count: { select: { viewLogs: true } },
              },
            },
          },
        })
      : Promise.resolve([]),
    userId
      ? prisma.omnisViewLog.findMany({
          where: { userId },
          distinct: ["cardId"],
          orderBy: { viewedAt: "desc" },
          take: 4,
          include: {
            card: {
              include: {
                category: { select: { name: true } },
                updatedBy: { select: { name: true } },
                _count: { select: { viewLogs: true } },
              },
            },
          },
        })
      : Promise.resolve([]),
    prisma.activityLog.findMany({
      where: { entity: { in: ["OMNIS_CARD", "TASK", "OMNIS_QUERY"] } },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { user: { select: { name: true } } },
    }),
  ])

  const bookmarkedIds = new Set(bookmarks.map((b) => b.cardId))

  const withVersion = (c: (typeof recent)[number]) => {
    let version = c.version
    try {
      version = getCardVersion(c.id, c.title) || c.version
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
      viewCount: c._count.viewLogs,
      bookmarked: bookmarkedIds.has(c.id),
      fresh: now - c.updatedAt.getTime() < ONE_DAY_MS,
      meta: `${c.category?.name ?? "—"} · ${c.updatedBy?.name ?? "—"} · ${formatRelative(c.updatedAt, now)}`,
    }
  }

  return (
    <>
      {/* 상단바는 모든 화면에 있어야 한다 — 채팅을 여는 단추가 여기 있고,
          어디서든 열 수 있어야 하기 때문이다. */}
      <Header title="HADD DB" />
      <HaddDbLanding
        totalCards={totalCards}
        categoryCount={categories.length}
        categories={categories.map((c) => ({ name: c.name, count: c._count.cards }))}
        activeFilter={activeFilter}
        recent={recent.map(withVersion)}
        popular={popular.map(withVersion)}
        mine={mine.map(withVersion)}
        bookmarks={bookmarks.map((b) => withVersion(b.card))}
        recentViews={recentViews.map((v) => ({
          ...withVersion(v.card),
          meta: `${v.card.category?.name ?? "—"} · 열람 ${formatRelative(v.viewedAt, now)}`,
        }))}
        activityLogs={activityLogs.map((log) => ({
          id: log.id,
          title: log.title,
          action: log.action,
          userName: log.user?.name ?? null,
          createdAt: log.createdAt.toISOString(),
        }))}
      />
      <CreateCardDialog
        categories={categories.map((c) => ({ id: c.id, name: c.name, icon: c.icon }))}
      />
    </>
  )
}

function formatRelative(d: Date, now: number): string {
  const diff = now - d.getTime()
  const days = Math.floor(diff / ONE_DAY_MS)
  if (days < 1) return "오늘"
  if (days === 1) return "어제"
  if (days < 7) return `${days}일 전`
  const weeks = Math.floor(days / 7)
  if (weeks < 4) return `${weeks}주 전`
  return d.toLocaleDateString("ko-KR")
}
