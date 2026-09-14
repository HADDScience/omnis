import { Header } from "@/components/layout/header"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import { HaddDbLanding, type ContextTile } from "@/components/omnis/hadd-db-landing"
import { compactWon, invoiceRevenue } from "@/lib/company-context"
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

  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "ADMIN"
  const thisYear = new Date().getUTCFullYear()

  const [contextTiles, [categories, totalCards, recent, popular, mine, bookmarks, recentViews, activityLogs]] = await Promise.all([
    loadContextTiles(isAdmin, thisYear),
    Promise.all([
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
    ]),
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
        contextTiles={contextTiles}
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

/** 회사 Context 타일 — 사람이 쓰는 카드가 아니라 이식 · 업무에서 쌓이는 회사 자료로 들어가는 입구 */
async function loadContextTiles(isAdmin: boolean, thisYear: number): Promise<ContextTile[]> {
  const [profile, lastConfirmed, provisional, records, latestRecord, staff, market, invoices] = await Promise.all([
    prisma.companyProfile.findUnique({ where: { id: "hadd" }, select: { nameKo: true } }),
    prisma.companyYear.findFirst({ where: { basis: "CONFIRMED" }, orderBy: { year: "desc" } }),
    invoiceRevenue(thisYear),
    prisma.companyRecord.count(),
    prisma.companyRecord.findFirst({ where: { startsOn: { not: null } }, orderBy: { startsOn: "desc" }, select: { title: true } }),
    isAdmin ? prisma.staffProfile.count({ where: { employment: "EMPLOYED" } }) : Promise.resolve(null),
    prisma.marketCompany.count(),
    prisma.taxInvoice.count(),
  ])
  const tiles: ContextTile[] = [
    {
      href: "/omnis/company",
      title: "회사 정보",
      value: lastConfirmed?.revenueKrw != null ? `${lastConfirmed.year} 매출 ${compactWon(Number(lastConfirmed.revenueKrw))}` : profile ? "기본정보" : "비어 있음",
      meta: provisional.invoices > 0 ? `${thisYear} 잠정 ${compactWon(provisional.total)} · 세금계산서 ${invoices}장` : (profile?.nameKo ?? "이식 전"),
    },
    {
      href: "/omnis/records",
      title: "연혁·실적",
      value: `${records}건`,
      meta: latestRecord?.title ?? "이식 전",
    },
    { href: "/omnis/market", title: "시장기업", value: `${market}곳`, meta: "경쟁 · 유사 기업" },
  ]
  if (staff !== null) tiles.push({ href: "/omnis/staff", title: "인력", value: `재직 ${staff}명`, meta: "관리자 전용 · 서명·직인" })
  return tiles
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
