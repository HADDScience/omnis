"use client"

import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { BookOpen01Icon, Search01Icon } from "@hugeicons/core-free-icons"
import { Kbd } from "@/components/ui/kbd"
import { useCommandPalette } from "@/components/layout/command-palette-context"

interface CardSummary {
  id: string
  title: string
  categoryName: string
  authorName: string | null
  updatedAt: string
  version: number
  fresh?: boolean
  meta?: string
}

interface HaddDbLandingProps {
  totalCards: number
  categoryCount: number
  categories: { name: string; count: number }[]
  recent: CardSummary[]
  popular: CardSummary[]
  mine: CardSummary[]
}

function CardEntry({ c, emphasized = false }: { c: CardSummary; emphasized?: boolean }) {
  return (
    <Link
      href={`/omnis/${c.id}`}
      className="block rounded-md border bg-card p-3 transition-colors hover:border-border-strong hover:bg-muted/40"
    >
      <div className="flex items-center gap-1.5">
        <HugeiconsIcon icon={BookOpen01Icon} size={13} className="text-muted-foreground" />
        <span
          className={[
            "flex-1 truncate text-[12.5px]",
            emphasized ? "font-semibold" : "font-medium",
          ].join(" ")}
        >
          {c.title}
        </span>
        {c.fresh && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <span className="flex-1 truncate text-[10.5px] text-muted-foreground">
          {c.meta ?? `${c.categoryName} · ${c.authorName ?? "—"}`}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">v{c.version}</span>
      </div>
    </Link>
  )
}

export function HaddDbLanding({
  totalCards,
  categoryCount,
  categories,
  recent,
  popular,
  mine,
}: HaddDbLandingProps) {
  const palette = useCommandPalette()
  const topTrigger = recent[0]?.title ?? "HPLC 세척 주기"

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[960px] px-12 pb-16 pt-12">
        <div className="mb-7 text-center">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            HADD DB
          </div>
          <h1 className="my-2 text-[32px] font-bold tracking-[-0.03em]">
            회사의 모든 지식, 한 번의 검색으로.
          </h1>
          <p className="text-[14px] text-muted-foreground">
            {totalCards} 카드 · {categoryCount} 카테고리 · 매주 업데이트
          </p>
        </div>

        <button
          type="button"
          onClick={() => palette.open()}
          className="flex w-full items-center gap-3 rounded-lg border bg-card px-5 py-4 text-[15px] text-muted-foreground shadow-[0_4px_12px_rgba(0,0,0,0.04)] transition-colors hover:border-border-strong"
        >
          <HugeiconsIcon icon={Search01Icon} size={16} />
          <span className="flex-1 text-left">검색 · &quot;{topTrigger}&quot;</span>
          <Kbd>⌘K</Kbd>
        </button>

        {/*
          규칙 20 (omnis/CLAUDE.md): 상단 Input = 검색 전용. 카테고리 버튼은 라우트 직접 진입.
          사용자 원본 #14 — 카테고리 클릭 → 검색 모달 대신 /omnis/c/[name] 진입.
        */}
        <div className="mt-3.5 flex flex-wrap justify-center gap-1.5">
          {categories.map((cat) => (
            <Link
              key={cat.name}
              href={`/omnis/c/${encodeURIComponent(cat.name)}`}
              className="rounded-full border bg-muted px-3 py-1 text-[12px] transition-colors hover:border-border-strong hover:bg-muted/70"
            >
              {cat.name} · {cat.count}
            </Link>
          ))}
        </div>

        <div className="mt-12 grid grid-cols-3 gap-4 md:gap-5">
          {[
            { title: "최근 수정", items: recent },
            { title: "많이 참조됨", items: popular },
            { title: "내가 편집", items: mine },
          ].map((col) => {
            const withFade = col.items.length > 5
            return (
              <div key={col.title}>
                <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {col.title}
                </div>
                <div
                  className={[
                    "flex flex-col gap-2 pr-1",
                    withFade
                      ? "max-h-[calc(100vh-380px)] overflow-y-auto [mask-image:linear-gradient(to_bottom,black_85%,transparent)] [&::-webkit-scrollbar]:hidden"
                      : "",
                  ].join(" ")}
                >
                  {col.items.length === 0 ? (
                    <div className="rounded-md border border-dashed p-3 text-center text-[11px] text-muted-foreground">
                      아직 카드 없음
                    </div>
                  ) : (
                    col.items.map((c, i) => <CardEntry key={c.id} c={c} emphasized={i === 0} />)
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
