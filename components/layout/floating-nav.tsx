"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
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
 * PC 에서는 페이지가 스크롤돼 내용이 nav 밑으로 들어갈 때만, 폰에서는 늘 — 바 가장자리에 가변 블러 띠를 깐다.
 * 글자가 유리 바로 밑에서 또렷하게 겹치지 않고 서서히 흐려지며 들어간다(Linear 의 스크롤 끝 가변 블러).
 */
function useMainScrolled() {
  const [scrolled, setScrolled] = useState(false)
  const pathname = usePathname()
  useEffect(() => {
    const el = document.querySelector<HTMLElement>("[data-main-scroll]")
    if (!el) return
    const check = () => setScrolled(el.scrollTop > 4)
    check()
    el.addEventListener("scroll", check, { passive: true })
    return () => el.removeEventListener("scroll", check)
  }, [pathname])
  return scrolled
}

/**
 * 사이드바 대신 화면 위에 떠 있는 유리 nav. PC 는 페이지 제목줄 가운데에 겹쳐 뜨고, 폰은 하단에 뜬다.
 * 두 모양은 CSS 로만 갈라 서버·클라이언트 첫 화면이 같다.
 *
 * 생김새는 Linear 의 리퀴드 글래스를 따른다(linear.app/now/linear-liquid-glass):
 * 탭은 캡슐 하나, 동작(검색·알림)은 옆의 따로 뜬 원. 현재 탭은 캡슐 안에서 미끄러지는 한 겹 더 진한 유리.
 * 누르면 살짝 눌렸다 돌아온다. 굴절은 넣지 않는다.
 */
export function FloatingNav({ userName }: FloatingNavProps) {
  const pathname = usePathname()
  const rightPanel = useRightPanel()
  const commandPalette = useCommandPalette()
  const keyboardOpen = useKeyboardOpen()
  const scrolled = useMainScrolled()
  // 알림 종은 PC 에서는 nav, 폰에서는 페이지 헤더에 하나만 둔다 — 둘 다 그리면 알림을 두 번씩 불러온다
  const isMdUp = useMediaQuery(NAV_DESKTOP_QUERY)

  const initial = userName?.charAt(0) ?? "?"
  const activeKey =
    TABS.find((tab) =>
      tab.key === "chat" && !CHAT_HOME_READY ? rightPanel.open : isActive(tab, pathname)
    )?.key ?? null

  return (
    <>
      {/* PC: 내용이 nav 밑으로 들어가면 위쪽 가장자리를 서서히 흐린다 */}
      <div
        aria-hidden
        className={cn(
          "nav-edge-top pointer-events-none fixed inset-x-0 top-[var(--demo-banner-height,0px)] z-[44] hidden h-14 transition-opacity duration-200 motion-reduce:transition-none md:block",
          scrolled ? "opacity-100" : "opacity-0"
        )}
      />
      {/* PC: 제목줄 가운데. 캡슐(탭) + 원(검색) + 원(알림) — 폭은 --nav-w 로 정해져 있고 제목줄이 그만큼 비워 둔다 */}
      <nav
        aria-label="주 메뉴"
        className="fixed left-1/2 top-[calc(var(--demo-banner-height,0px)+0.25rem)] z-[var(--z-nav)] hidden w-[var(--nav-w)] -translate-x-1/2 items-center gap-1.5 md:flex"
      >
        <TabCapsule variant="top" activeKey={activeKey} initial={initial} />
        <button
          type="button"
          onClick={() => commandPalette.open()}
          aria-label="검색 (⌘K)"
          title="검색 (⌘K)"
          className={cn(CIRCLE, "text-muted-foreground hover:text-foreground")}
        >
          <HugeiconsIcon icon={Search01Icon} size={16} aria-hidden />
        </button>
        <div className={cn(CIRCLE, "[&_button]:size-10 [&_button]:rounded-full")}>
          {isMdUp && <NotificationBell />}
        </div>
      </nav>

      {/* 폰: 하단 가장자리 가변 블러 — 목록 끝이 nav 밑으로 서서히 사라진다 */}
      <div
        aria-hidden
        className={cn(
          "nav-edge-bottom pointer-events-none fixed inset-x-0 bottom-0 z-[44] h-[calc(var(--nav-offset-bottom)+12px)] md:hidden",
          keyboardOpen && "hidden"
        )}
      />
      {/* 폰: 하단 가운데. 홈 인디케이터 위로 띄운다.
          터치 기기에서 칸은 44px 이상이라 200px 폭에서는 다섯 칸(220px)이 넘친다 — 그때는 nav 안에서 민다 */}
      <nav
        aria-label="주 메뉴"
        className={cn(
          "fixed inset-x-3 bottom-[calc(var(--safe-bottom)+8px)] z-[var(--z-nav)] flex transition-transform duration-200 motion-reduce:transition-none md:hidden",
          keyboardOpen && "pointer-events-none translate-y-[calc(100%+24px)]"
        )}
      >
        <TabCapsule variant="bottom" activeKey={activeKey} initial={initial} />
      </nav>
    </>
  )
}

/** 따로 뜬 동작 원. 탭 캡슐과 같은 높이(2.5rem) */
const CIRCLE =
  "glass flex size-10 shrink-0 items-center justify-center rounded-full transition-transform duration-150 active:scale-[0.94] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"

/**
 * 탭 캡슐. 현재 탭 표시는 탭마다 칠하지 않고 캡슐 안의 알약 하나가 그 탭 밑으로 미끄러진다 —
 * 탭을 옮겨 다닐 때 「같은 유리가 움직인다」 는 연속성을 준다. 재기 전(첫 화면)에는 현재 탭이 직접 알약을 입는다.
 */
function TabCapsule({
  variant,
  activeKey,
  initial,
}: {
  variant: "top" | "bottom"
  activeKey: string | null
  initial: string
}) {
  const rightPanel = useRightPanel()
  const capsule = useRef<HTMLDivElement>(null)
  const tabs = useRef(new Map<string, HTMLElement>())
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null)

  const measure = useCallback(() => {
    const el = activeKey ? tabs.current.get(activeKey) : undefined
    if (!el || !capsule.current || el.offsetWidth === 0) {
      setPill(null)
      return
    }
    setPill({ x: el.offsetLeft, w: el.offsetWidth })
  }, [activeKey])

  useLayoutEffect(() => {
    measure()
  }, [measure])
  useEffect(() => {
    if (!capsule.current) return
    const ro = new ResizeObserver(measure)
    ro.observe(capsule.current)
    return () => ro.disconnect()
  }, [measure])

  return (
    <div
      ref={capsule}
      className={cn(
        "glass flex items-stretch rounded-full p-1",
        variant === "top" ? "flex-1" : "w-full gap-0.5 overflow-x-auto rounded-[24px] [scrollbar-width:none]"
      )}
    >
      {pill && (
        <span
          aria-hidden
          className={cn(
            "glass-pill pointer-events-none absolute left-0 top-1 bottom-1 rounded-full transition-[transform,width] duration-300 ease-[cubic-bezier(0.3,1.3,0.5,1)] motion-reduce:transition-none",
            variant === "bottom" && "rounded-[20px]"
          )}
          style={{ transform: `translateX(${pill.x}px)`, width: pill.w }}
        />
      )}
      {TABS.map((tab) => {
        const active = tab.key === activeKey
        // 채팅 화면이 없는 동안의 채팅 탭은 이동이 아니라 패널 여닫기다
        const panelTab = tab.key === "chat" && !CHAT_HOME_READY
        const icon =
          tab.key === "me" ? (
            <span
              aria-hidden
              className={cn(
                "flex items-center justify-center rounded-full font-semibold",
                variant === "top" ? "size-[18px] text-[10px]" : "size-[22px] text-[11px]",
                active ? "bg-foreground text-background" : "bg-muted-foreground/20 text-muted-foreground"
              )}
            >
              {initial}
            </span>
          ) : (
            <HugeiconsIcon icon={ICONS[tab.key as keyof typeof ICONS]} size={variant === "top" ? 16 : 20} aria-hidden />
          )
        const className = cn(
          "relative z-[1] flex items-center justify-center rounded-full transition-[color,transform] duration-150 active:scale-[0.94] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          variant === "top"
            ? // md 는 아이콘만(폭 2.5rem), lg 부터 글자까지(5.75rem) — 이 폭이 globals.css 의 --nav-w 를 만든다
              "h-8 w-10 shrink-0 gap-1.5 text-[12.5px] lg:w-[5.75rem]"
            : "touch-target min-w-0 flex-1 flex-col gap-0.5 rounded-[20px] py-1.5 text-[10.5px]",
          active ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
          // 재기 전에는 현재 탭이 직접 알약을 입는다
          active && !pill && "glass-pill"
        )
        const label = (
          <span
            className={cn(
              "whitespace-nowrap",
              variant === "top" ? "sr-only lg:not-sr-only" : "max-[319px]:sr-only"
            )}
          >
            {tab.label}
          </span>
        )
        const ref = (el: HTMLElement | null) => {
          if (el) tabs.current.set(tab.key, el)
          else tabs.current.delete(tab.key)
        }

        if (panelTab) {
          return (
            <button
              key={tab.key}
              ref={ref}
              type="button"
              data-onboarding={tab.onboarding}
              aria-pressed={active}
              title={variant === "top" ? tab.label : undefined}
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
            ref={ref}
            href={tab.href}
            data-onboarding={tab.onboarding}
            aria-current={active ? "page" : undefined}
            title={variant === "top" ? tab.label : undefined}
            className={className}
          >
            {icon}
            {label}
            <LinkPendingMark />
          </Link>
        )
      })}
    </div>
  )
}
