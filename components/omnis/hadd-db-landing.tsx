"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import type { MouseEvent } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  BookOpen01Icon,
  Search01Icon,
  PlusSignIcon,
  BubbleChatSparkIcon,
  ArrowRight02Icon,
  FolderLibraryIcon,
  StarIcon,
} from "@hugeicons/core-free-icons"
import { Kbd } from "@/components/ui/kbd"
import { useCommandPalette } from "@/components/layout/command-palette-context"

interface CardSummary {
  id: string
  title: string
  categoryName: string
  authorName: string | null
  updatedAt: string
  version: number
  viewCount?: number
  bookmarked?: boolean
  fresh?: boolean
  meta?: string
}

interface HaddDbLandingProps {
  totalCards: number
  categoryCount: number
  categories: { name: string; count: number }[]
  activeFilter: "all" | "bookmarks"
  recent: CardSummary[]
  popular: CardSummary[]
  mine: CardSummary[]
  bookmarks: CardSummary[]
  recentViews: CardSummary[]
  activityLogs: {
    id: string
    title: string
    action: string
    userName: string | null
    createdAt: string
  }[]
}

function CardEntry({ c, emphasized = false }: { c: CardSummary; emphasized?: boolean }) {
  const router = useRouter()
  const [bookmarked, setBookmarked] = useState(!!c.bookmarked)
  const [pending, setPending] = useState(false)

  async function toggleBookmark(e: MouseEvent<HTMLButtonElement>) {
    e.preventDefault()
    e.stopPropagation()
    setPending(true)
    try {
      const res = await fetch(bookmarked ? `/api/bookmarks/${c.id}` : "/api/bookmarks", {
        method: bookmarked ? "DELETE" : "POST",
        headers: bookmarked ? undefined : { "Content-Type": "application/json" },
        body: bookmarked ? undefined : JSON.stringify({ cardId: c.id }),
      })
      if (res.ok) {
        setBookmarked((v) => !v)
        router.refresh()
      }
    } finally {
      setPending(false)
    }
  }

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
        <button
          type="button"
          disabled={pending}
          onClick={toggleBookmark}
          className={[
            "rounded p-0.5 transition-colors hover:bg-muted",
            bookmarked ? "text-primary" : "text-muted-foreground",
          ].join(" ")}
          aria-label={bookmarked ? "즐겨찾기 해제" : "즐겨찾기 추가"}
        >
          <HugeiconsIcon icon={StarIcon} size={13} />
        </button>
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <span className="flex-1 truncate text-[10.5px] text-muted-foreground">
          {c.meta ?? `${c.categoryName} · ${c.authorName ?? "—"}`}
        </span>
        {typeof c.viewCount === "number" && (
          <span className="text-[10px] text-muted-foreground">조회 {c.viewCount}</span>
        )}
        <span className="font-mono text-[10px] text-muted-foreground">v{c.version}</span>
      </div>
    </Link>
  )
}

export function HaddDbLanding({
  totalCards,
  categoryCount,
  categories,
  activeFilter,
  recent,
  popular,
  mine,
  bookmarks,
  recentViews,
  activityLogs,
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

        <div className="flex items-stretch gap-2">
          <button
            type="button"
            onClick={() => palette.open()}
            className="flex flex-1 items-center gap-3 rounded-lg border bg-card px-5 py-4 text-[15px] text-muted-foreground shadow-[0_4px_12px_rgba(0,0,0,0.04)] transition-colors hover:border-border-strong"
          >
            <HugeiconsIcon icon={Search01Icon} size={16} />
            <span className="flex-1 text-left">검색 · &quot;{topTrigger}&quot;</span>
            <Kbd>⌘K</Kbd>
          </button>
          <Link
            href="/omnis?create=1"
            className="inline-flex shrink-0 items-center gap-2 rounded-lg border bg-primary px-4 py-4 text-[13.5px] font-semibold text-primary-foreground shadow-[0_4px_12px_rgba(0,0,0,0.04)] transition-opacity hover:opacity-90"
            aria-label="새 지식카드 만들기"
          >
            <HugeiconsIcon icon={PlusSignIcon} size={15} />
            새 카드
          </Link>
        </div>

        {/*
          규칙 20 (omnis/CLAUDE.md): 상단 Input = 검색 전용. 카테고리 버튼은 라우트 직접 진입.
          사용자 원본 #14 — 카테고리 클릭 → 검색 모달 대신 /omnis/c/[name] 진입.
        */}
        <div className="mt-3.5 flex flex-wrap justify-center gap-1.5">
          <Link
            href="/omnis"
            className={`rounded-full border px-3 py-1 text-[12px] transition-colors hover:border-border-strong ${
              activeFilter === "all" ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70"
            }`}
          >
            전체
          </Link>
          <Link
            href="/omnis?filter=bookmarks"
            className={`rounded-full border px-3 py-1 text-[12px] transition-colors hover:border-border-strong ${
              activeFilter === "bookmarks" ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70"
            }`}
          >
            즐겨찾기 · {bookmarks.length}
          </Link>
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

        {/* 사내 자료(NAS) 진입.
            사이드바에 「사내 자료」로 따로 서 있었는데 HADD DB 와 무엇이 다른지
            헷갈렸다. 둘 다 사내 자료를 보는 곳이니 당연하다. 카드로 정리된 지식이
            HADD DB 고, 아직 NAS 에 파일로만 있는 것이 저쪽이다. */}
        <Link
          href="/omnis/nas"
          className="mt-3.5 flex items-center gap-3 rounded-lg border bg-card px-5 py-3.5 transition-colors hover:border-border-strong hover:bg-muted/40"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <HugeiconsIcon icon={FolderLibraryIcon} size={19} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold">사내 자료 (NAS)</div>
            <div className="truncate text-[11.5px] text-muted-foreground">
              아직 카드로 정리되지 않고 시놀로지에 파일로만 있는 것들
            </div>
          </div>
          <HugeiconsIcon
            icon={ArrowRight02Icon}
            size={16}
            className="shrink-0 text-muted-foreground"
            aria-hidden
          />
        </Link>

        {/* 옴니스 RAG 질문 진입 — 자연어 질문 → 사내 지식 기반 답변 */}
        <Link
          href="/omnis/ask"
          className="ai-rainbow-border mt-3.5 flex items-center gap-3 rounded-lg bg-primary/[0.06] px-5 py-3.5 transition-colors hover:bg-primary/10"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <HugeiconsIcon icon={BubbleChatSparkIcon} size={19} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold">옴니스에게 질문하기</div>
            <div className="truncate text-[11.5px] text-muted-foreground">
              자연어로 물어보면 사내 지식에서 바로 답을 찾아드려요
            </div>
          </div>
          <HugeiconsIcon
            icon={ArrowRight02Icon}
            size={16}
            className="shrink-0 text-primary"
          />
        </Link>

        <div className="mt-12 grid grid-cols-3 gap-4 md:gap-5">
          {(activeFilter === "bookmarks"
            ? [
                { title: "즐겨찾기", items: bookmarks },
                { title: "최근 열람", items: recentViews },
                { title: "많이 참조됨", items: popular },
              ]
            : [
                { title: "최근 수정", items: recent },
                { title: "많이 참조됨", items: popular },
                { title: "최근 열람", items: recentViews.length > 0 ? recentViews : mine },
              ]
          ).map((col) => {
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
        <div className="mt-8">
          <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            활동 이력
          </div>
          <div className="rounded-md border bg-card">
            {activityLogs.length === 0 ? (
              <div className="p-3 text-[11px] text-muted-foreground">기록 없음</div>
            ) : (
              activityLogs.map((log) => (
                <div key={log.id} className="flex items-center gap-2 border-b px-3 py-2 last:border-b-0">
                  <span className="min-w-0 flex-1 truncate text-[12px]">{log.title}</span>
                  <span className="text-[10px] text-muted-foreground">{log.userName ?? "system"}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
