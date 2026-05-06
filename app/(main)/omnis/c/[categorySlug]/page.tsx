import Link from "next/link"
import { notFound } from "next/navigation"
import { prisma } from "@/lib/db"
import { Header } from "@/components/layout/header"
import { HugeiconsIcon } from "@hugeicons/react"
import { BookOpen01Icon, ArrowLeft01Icon } from "@hugeicons/core-free-icons"
import { getCardVersion } from "@/lib/omnis-git"

export const dynamic = "force-dynamic"

const ONE_DAY_MS = 24 * 60 * 60 * 1000

interface Props {
  params: Promise<{ categorySlug: string }>
}

/**
 * Omnis 카테고리 직접 진입 라우트 (#14).
 * 사용자 원본 #14: "기업정보 인력현황 지식재산권 버튼을 누르면 검색이 뜨는데 ux에 맞지 않는다."
 * 해결: 카테고리 버튼 → /omnis/c/[name] 라우트 직접 진입 (검색 X).
 *
 * 슬러그는 카테고리 name (unique). 한국어 그대로 사용 (URL은 encodeURIComponent).
 */
export default async function OmnisCategoryPage({ params }: Props) {
  const { categorySlug } = await params
  const decoded = decodeURIComponent(categorySlug)

  const category = await prisma.omnisCategory.findUnique({
    where: { name: decoded },
    include: {
      cards: {
        orderBy: { updatedAt: "desc" },
        include: { updatedBy: { select: { name: true } } },
      },
    },
  })

  if (!category) notFound()

  const cards = category.cards.map((c) => {
    let version = c.version
    try {
      version = getCardVersion(c.id, c.title)
    } catch {
      /* keep db version */
    }
    return {
      id: c.id,
      title: c.title,
      authorName: c.updatedBy?.name ?? null,
      updatedAt: c.updatedAt,
      version,
      fresh: Date.now() - c.updatedAt.getTime() < ONE_DAY_MS,
    }
  })

  return (
    <>
      <Header title={`Omnis · ${category.name}`} />
      <div className="h-full overflow-auto">
        <div className="mx-auto w-full max-w-[960px] px-6 py-8 sm:px-12 sm:py-10">
          {/* Breadcrumb */}
          <nav aria-label="경로" className="mb-6 flex items-center gap-2 text-[12px] text-muted-foreground">
            <Link
              href="/omnis"
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-muted hover:text-foreground"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={12} />
              Omnis
            </Link>
            <span aria-hidden>/</span>
            <span className="font-medium text-foreground">
              {category.icon ? `${category.icon} ` : ""}{category.name}
            </span>
          </nav>

          <header className="mb-7">
            <h1 className="text-[24px] font-bold tracking-[-0.02em]">
              {category.icon ? `${category.icon} ` : ""}{category.name}
            </h1>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {cards.length}개 카드
            </p>
          </header>

          {cards.length === 0 ? (
            <div className="rounded-md border border-dashed py-12 text-center text-[13px] text-muted-foreground">
              아직 카드가 없습니다.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
              {cards.map((c) => (
                <Link
                  key={c.id}
                  href={`/omnis/${c.id}`}
                  className="group block rounded-md border bg-card p-4 transition-colors hover:border-border-strong hover:bg-muted/40"
                >
                  <div className="flex items-center gap-1.5">
                    <HugeiconsIcon icon={BookOpen01Icon} size={14} className="text-muted-foreground" />
                    <span className="flex-1 truncate text-[13px] font-medium">
                      {c.title}
                    </span>
                    {c.fresh && (
                      <span aria-label="최근 수정" className="h-1.5 w-1.5 rounded-full bg-primary" />
                    )}
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span className="truncate">{c.authorName ?? "—"}</span>
                    <span className="font-mono">v{c.version}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
