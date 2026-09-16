"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import type { MouseEvent } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  BookOpen01Icon,
  Search01Icon,
  BubbleChatSparkIcon,
  ArrowRight02Icon,
  FolderLibraryIcon,
  StarIcon,
  SparklesIcon,
  HierarchyIcon,
} from "@hugeicons/core-free-icons"
import { Kbd } from "@/components/ui/kbd"
import { useCommandPalette } from "@/components/layout/command-palette-context"

import { apiUrl } from "@/lib/base-path"
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

/** 회사 Context 입구 — 회사 정보 · 연혁 · 시장기업 · 인력(관리자) */
export interface ContextTile {
  href: string
  title: string
  value: string
  meta: string
}

interface HaddDbLandingProps {
  contextTiles: ContextTile[]
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
      const res = await fetch(apiUrl(bookmarked ? `/api/bookmarks/${c.id}` : "/api/bookmarks"), {
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
  contextTiles,
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
  const hasCards = totalCards > 0
  /* 카드가 0건일 때 없는 카드 제목("HPLC 세척 주기")을 예시로 걸면 있는 것처럼 보인다.
     그때는 검색이 실제로 훑는 범위를 적는다 — app/api/search/route.ts 기준. */
  const searchHint = recent[0]?.title ?? null

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[960px] px-4 pb-16 pt-8 sm:px-8 md:px-12 md:pt-12">
        <div className="mb-6 text-center">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            HADD DB
          </div>
          <h1 className="my-2 text-[24px] font-bold tracking-[-0.03em] sm:text-[32px]">
            회사가 쌓아 온 것, 한자리에.
          </h1>
          {/* 부제는 화면에 실제로 있는 것만 말한다. 카드 0건에 "매주 업데이트"라고 쓰면
              첫 줄부터 거짓이 된다 — 카드 수는 카드가 생긴 뒤에 내세운다. */}
          <p className="text-[14px] text-muted-foreground">
            {hasCards
              ? `카드 ${totalCards} · 카테고리 ${categoryCount}`
              : "회사 정보 · 연혁 · 시장기업부터. 카드는 AI 제안으로 쌓입니다"}
          </p>
        </div>

        {/* 회사 Context — 이식 · 업무에서 쌓이는 회사 자료. 카드처럼 사람이 쓰지 않는다.
            이 화면에서 유일하게 내용이 차 있는 곳이라 맨 앞에 둔다(2026-09-16 결정).
            카드가 쌓이고 검색이 회사 자료까지 훑게 되면 검색을 다시 앞으로 올린다. */}
        <nav aria-label="회사 Context" className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          {contextTiles.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="touch-target min-w-0 rounded-lg border bg-card px-4 py-4 shadow-[0_4px_12px_rgba(0,0,0,0.04)] transition-colors hover:border-border-strong hover:bg-muted/40"
            >
              <div className="text-[11.5px] text-muted-foreground">{t.title}</div>
              <div className="mt-1 truncate text-[17px] font-semibold tabular-nums">{t.value}</div>
              <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{t.meta}</div>
            </Link>
          ))}
        </nav>

        {/* 사람이 문서를 한 땀씩 쓰는 곳이 아니라 Context 를 살펴보는 곳이다(2026-09-14 결정) —
            「새 카드」 버튼을 앞에서 뺐다. 카드는 AI 가 업무에서 뽑아 제안한다. */}
        <div className="mt-3.5 flex items-stretch gap-2">
          <button
            type="button"
            onClick={() => palette.open()}
            className="flex flex-1 items-center gap-3 rounded-lg border bg-card px-5 py-3.5 text-[14px] text-muted-foreground transition-colors hover:border-border-strong"
          >
            <HugeiconsIcon icon={Search01Icon} size={16} />
            <span className="flex-1 truncate text-left">
              {searchHint ? `검색 · "${searchHint}"` : "검색 · 업무 · 보고서 · 지식재산권"}
            </span>
            {/* 물리 키보드가 없는 기기에선 단축키 힌트를 숨긴다 */}
            <Kbd className="hidden md:inline-flex">⌘K</Kbd>
          </button>
        </div>

        {/*
          규칙 20 (omnis/CLAUDE.md): 상단 Input = 검색 전용. 카테고리 버튼은 라우트 직접 진입.
          사용자 원본 #14 — 카테고리 클릭 → 검색 모달 대신 /omnis/c/[name] 진입.
          카드가 한 장도 없으면 칩이 전부 · 0 이고 눌러도 빈 화면이라 줄째로 감춘다.
        */}
        {hasCards && (
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
        )}

        {/* Context 그래프 — 대상 하나를 가운데 두고 DB 연결(실선)과 의미상 이웃(점선)을 펼친다 */}
        <Link
          href="/omnis/context"
          className="mt-3.5 flex items-center gap-3 rounded-lg border bg-card px-5 py-3.5 transition-colors hover:border-border-strong hover:bg-muted/40"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <HugeiconsIcon icon={HierarchyIcon} size={19} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold">Context 살펴보기</div>
            <div className="text-[11.5px] leading-snug text-muted-foreground">
              업무 · 사람 · 기관 · 특허가 어떻게 이어져 있는지, AI 가 무엇을 읽는지 그래프로
            </div>
          </div>
          <HugeiconsIcon icon={ArrowRight02Icon} size={16} className="shrink-0 text-muted-foreground" aria-hidden />
        </Link>

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
            <div className="text-[11.5px] leading-snug text-muted-foreground">
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

        {/* AI 카드 제안 진입 — 업무에서 뽑은 지식을 사람이 확인한다 */}
        <Link
          href="/omnis/proposals"
          className="mt-3.5 flex items-center gap-3 rounded-lg border bg-card px-5 py-3.5 transition-colors hover:border-border-strong hover:bg-muted/40"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <HugeiconsIcon icon={SparklesIcon} size={19} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold">AI 카드 제안</div>
            <div className="truncate text-[11.5px] text-muted-foreground">
              업무가 끝나면 AI 가 찾아낸 회사 지식을 확인하고 카드에 반영해요
            </div>
          </div>
          <HugeiconsIcon icon={ArrowRight02Icon} size={16} className="shrink-0 text-muted-foreground" aria-hidden />
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
            <div className="text-[11.5px] leading-snug text-muted-foreground">
              자연어로 물어보면 사내 지식에서 바로 답을 찾아드려요
            </div>
          </div>
          <HugeiconsIcon
            icon={ArrowRight02Icon}
            size={16}
            className="shrink-0 text-primary"
          />
        </Link>

        {/* 카드 목록 3열. 카드가 없으면 "아직 카드 없음" 상자 셋이 화면 절반을 차지한다 —
            빈 상태를 세 번 보여 주는 대신 줄째로 감추고, 카드가 생기면 그대로 돌아온다. */}
        {hasCards && (
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 md:mt-12 md:gap-5 lg:grid-cols-3">
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
                      ? "max-h-[calc(var(--app-vh)-380px)] overflow-y-auto [mask-image:linear-gradient(to_bottom,black_85%,transparent)] [&::-webkit-scrollbar]:hidden"
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
        )}

        <div className="mt-8">
          <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            활동 이력
          </div>
          <div className="rounded-md border bg-card">
            {activityLogs.length === 0 ? (
              <div className="p-3 text-[11px] text-muted-foreground">기록 없음</div>
            ) : (
              activityLogs.map((log) => (
                <div key={log.id} className="flex items-start gap-2 border-b px-3 py-2 last:border-b-0">
                  <span className="min-w-0 flex-1 line-clamp-2 text-[12px]">{log.title}</span>
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
