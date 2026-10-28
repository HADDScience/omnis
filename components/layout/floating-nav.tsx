"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Archive02Icon,
  BubbleChatIcon,
  Calendar03Icon,
  Search01Icon,
  Task01Icon,
} from "@hugeicons/core-free-icons"
import { OmnisMark } from "@/components/brand/omnis-mark"
import { LinkPendingMark } from "@/components/ui/pending-link"
import { cn } from "@/lib/utils"
import { useMediaQuery } from "@/hooks/use-media-query"
import { useCommandPalette } from "./command-palette-context"
import { useRightPanel } from "./right-panel-context"
import { NotificationBell } from "./notification-bell"

/**
 * 채팅 화면(홈)이 들어오기 전에는 채팅 탭이 오른쪽 채팅 패널을 연다 — 「전체」 팀 채팅이 거기 있다.
 * 홈 세션이 `/` 를 메신저로 바꾸면 이 값을 true 로 돌린다(mydocs/plans/2026-10-28-floating-nav.md).
 */
const CHAT_HOME_READY = false

/** nav 가 상단으로 올라가는 폭. Tailwind md 와 globals.css 의 --nav-offset-* 기준과 같다 */
export const NAV_DESKTOP_QUERY = "(min-width: 768px)"

type Tab = {
  key: string
  href: string
  label: string
  /** 이 경로들 아래에 있으면 이 탭이 켜진다 */
  match: readonly string[]
  /** 탭 안내(온보딩 투어)가 찾는 표식 */
  onboarding?: string
}

/** 탭 정의는 여기 한 곳 — 사이드바의 메뉴 목록을 대신한다. 「마이」 는 아이콘 대신 이름 첫 글자를 그린다. */
const TABS: readonly Tab[] = [
  { key: "chat", href: "/", label: "채팅", match: ["/chat"], onboarding: "ai" },
  { key: "tasks", href: "/tasks", label: "업무", match: ["/tasks"], onboarding: "tasks" },
  { key: "calendar", href: "/calendar", label: "캘린더", match: ["/calendar"] },
  // 아카이브 = 회사가 가진 것: 지식 카드 · 시놀로지 NAS · 지식재산권 · 고객·견적
  { key: "archive", href: "/omnis", label: "아카이브", match: ["/omnis", "/nas", "/crm"], onboarding: "resources" },
  { key: "me", href: "/settings", label: "마이", match: ["/settings"], onboarding: "profile" },
]

const ICONS = {
  chat: BubbleChatIcon,
  tasks: Task01Icon,
  calendar: Calendar03Icon,
  archive: Archive02Icon,
} as const

function isActive(tab: Tab, pathname: string) {
  if (tab.key === "chat" && pathname === "/") return true
  return tab.match.some((p) => pathname === p || pathname.startsWith(p + "/"))
}

/**
 * 폰에서 키보드가 올라오면 하단 nav 가 입력창 위로 떠서 글 쓰는 자리를 가린다 — 그동안은 내린다.
 * visualViewport 가 화면의 3/4 밑으로 줄면 키보드가 열린 것으로 본다.
 */
function useKeyboardOpen() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const check = () => setOpen(vv.height < window.innerHeight * 0.75)
    vv.addEventListener("resize", check)
    return () => vv.removeEventListener("resize", check)
  }, [])
  return open
}

interface FloatingNavProps {
  userName?: string | null
}

/**
 * 사이드바 대신 화면 위에 떠 있는 유리 nav. PC 는 상단 가운데, 폰은 하단 가운데.
 * 두 모양은 CSS 로만 갈라 서버·클라이언트 첫 화면이 같다.
 */
export function FloatingNav({ userName }: FloatingNavProps) {
  const pathname = usePathname()
  const rightPanel = useRightPanel()
  const commandPalette = useCommandPalette()
  const keyboardOpen = useKeyboardOpen()
  // 알림 종은 PC 에서는 nav, 폰에서는 페이지 헤더에 하나만 둔다 — 둘 다 그리면 알림을 두 번씩 불러온다
  const isMdUp = useMediaQuery(NAV_DESKTOP_QUERY)

  const initial = userName?.charAt(0) ?? "?"

  function renderTab(tab: Tab, variant: "top" | "bottom") {
    // 채팅 화면이 없는 동안의 채팅 탭은 이동이 아니라 패널 여닫기다
    const panelTab = tab.key === "chat" && !CHAT_HOME_READY
    const active = panelTab ? rightPanel.open : isActive(tab, pathname)
    const icon =
      tab.key === "me" ? (
        <span
          aria-hidden
          className={cn(
            "flex items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground",
            variant === "top" ? "size-5 text-[10px]" : "size-[22px] text-[11px]",
            active && "bg-primary text-primary-foreground"
          )}
        >
          {initial}
        </span>
      ) : (
        <HugeiconsIcon icon={ICONS[tab.key as keyof typeof ICONS]} size={variant === "top" ? 15 : 20} aria-hidden />
      )

    const className = cn(
      "relative flex items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
      "has-data-[pending]:bg-[var(--glass-active)]",
      variant === "top"
        ? "h-8 gap-1.5 px-3 text-[12.5px]"
        : // 칸 다섯 개가 폭을 나눈다. 320px 밑에서는 라벨을 감추고 아이콘만 남긴다
          "touch-target min-w-0 flex-1 flex-col gap-0.5 py-1.5 text-[10.5px]",
      active
        ? "bg-[var(--glass-active)] font-semibold text-foreground"
        : "text-muted-foreground hover:text-foreground"
    )
    const label = (
      <span className={cn("whitespace-nowrap", variant === "bottom" && "max-[319px]:sr-only")}>
        {tab.label}
      </span>
    )

    if (panelTab) {
      return (
        <button
          key={tab.key}
          type="button"
          data-onboarding={tab.onboarding}
          aria-pressed={active}
          onClick={() => (rightPanel.open ? rightPanel.setOpen(false) : rightPanel.openWith("all"))}
          className={className}
        >
          {icon}
          {label}
        </button>
      )
    }
    return (
      <Link
        key={tab.key}
        href={tab.href}
        data-onboarding={tab.onboarding}
        aria-current={active ? "page" : undefined}
        className={className}
      >
        {icon}
        {label}
        <LinkPendingMark />
      </Link>
    )
  }

  return (
    <>
      {/* PC: 상단 가운데 */}
      <nav
        aria-label="주 메뉴"
        className="glass fixed left-1/2 top-[calc(var(--demo-banner-height,0px)+10px)] z-[var(--z-nav)] hidden -translate-x-1/2 items-center gap-1 rounded-full p-1 md:flex"
      >
        <Link
          href="/tasks"
          aria-label="Omnis 처음으로"
          className="flex h-8 items-center gap-1.5 rounded-full pl-1.5 pr-2.5 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <OmnisMark className="size-[22px] rounded-[6px]" />
          <span className="text-[12.5px] font-semibold">Omnis</span>
        </Link>
        <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
        {TABS.map((tab) => renderTab(tab, "top"))}
        <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
        <button
          type="button"
          onClick={() => commandPalette.open()}
          aria-label="검색 (⌘K)"
          title="검색 (⌘K)"
          className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <HugeiconsIcon icon={Search01Icon} size={15} aria-hidden />
        </button>
        {isMdUp && <NotificationBell />}
      </nav>

      {/* 폰: 하단 가운데. 홈 인디케이터 위로 띄운다.
          터치 기기에서 칸은 44px 이상이라 200px 폭에서는 다섯 칸(220px)이 넘친다 — 그때는 nav 안에서 민다 */}
      <nav
        aria-label="주 메뉴"
        className={cn(
          "glass fixed inset-x-3 bottom-[calc(var(--safe-bottom)+8px)] z-[var(--z-nav)] flex items-stretch gap-0.5 overflow-x-auto rounded-[22px] p-1 [scrollbar-width:none] transition-transform duration-200 motion-reduce:transition-none md:hidden",
          keyboardOpen && "pointer-events-none translate-y-[calc(100%+24px)]"
        )}
      >
        {TABS.map((tab) => renderTab(tab, "bottom"))}
      </nav>
    </>
  )
}
