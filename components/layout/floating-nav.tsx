"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Archive02Icon,
  BubbleChatIcon,
  Calendar03Icon,
  Task01Icon,
} from "@hugeicons/core-free-icons"
import { LinkPendingMark } from "@/components/ui/pending-link"
import { cn } from "@/lib/utils"
import { useMediaQuery } from "@/hooks/use-media-query"
import { MeAvatarLink } from "./current-user"
import { useRightPanel } from "./right-panel-context"
import { NotificationBell } from "./notification-bell"

/**
 * 채팅 화면(홈)이 들어오기 전에는 채팅 탭이 오른쪽 채팅 패널을 열었다 — 「전체」 팀 채팅이 거기 있다.
 * 메신저(/chat, mydocs/plans/2026-10-28-omnis-messenger-agent.md 2단계)가 들어와 이제 탭은 그 화면으로 간다.
 */
const CHAT_HOME_READY = true

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

/** 탭 정의는 여기 한 곳 — 사이드바의 메뉴 목록을 대신한다. 마이(계정·설정)는 탭이 아니라 아바타(MeAvatarLink)다. */
const TABS: readonly Tab[] = [
  // `/` 는 /chat 으로 보내기만 한다(app/page.tsx 는 셸 밖 랜딩) — 누를 때마다 한 번 더 돌지 않게 /chat 으로 바로 간다.
  // 방 주소(/chat/[roomId] · /chat/task/[taskId] · /chat/new)는 접두사 /chat 이 켠다
  { key: "chat", href: "/chat", label: "채팅", match: ["/chat"], onboarding: "ai" },
  { key: "tasks", href: "/tasks", label: "업무", match: ["/tasks"], onboarding: "tasks" },
  { key: "calendar", href: "/calendar", label: "캘린더", match: ["/calendar"] },
  // 아카이브 = 회사가 가진 것: 지식 카드 · 시놀로지 NAS · 지식재산권 · 고객·견적
  { key: "archive", href: "/omnis", label: "아카이브", match: ["/omnis", "/nas", "/crm"], onboarding: "resources" },
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
 * 탭은 캡슐 하나, 알림·마이는 옆의 따로 뜬 원. 현재 탭은 캡슐 안에서 미끄러지는 한 겹 더 진한 유리.
 * 누르면 살짝 눌렸다 돌아온다. 굴절은 넣지 않는다.
 */
export function FloatingNav() {
  const pathname = usePathname()
  const rightPanel = useRightPanel()
  const keyboardOpen = useKeyboardOpen()
  const scrolled = useMainScrolled()
  // 알림 종은 PC 에서는 nav, 폰에서는 페이지 헤더에 하나만 둔다 — 둘 다 그리면 알림을 두 번씩 불러온다
  const isMdUp = useMediaQuery(NAV_DESKTOP_QUERY)

  // 누른 탭을 바로 켠다. 주소(pathname)는 새 화면이 다 그려진 뒤에야 바뀌어서, 그것만 보면 업무 보드처럼
  // 무거운 화면으로 갈 때 알약이 옛 탭에 한참 머물렀다. 주소가 바뀌면(도착하면) 누른 표시는 내려놓는다
  const [pending, setPending] = useState<{ key: string; from: string } | null>(null)
  if (pending && pending.from !== pathname) setPending(null)
  const routeKey =
    TABS.find((tab) =>
      tab.key === "chat" && !CHAT_HOME_READY ? rightPanel.open : isActive(tab, pathname)
    )?.key ?? null
  const activeKey = pending?.key ?? routeKey
  const select = (key: string) => {
    if (key !== routeKey) setPending({ key, from: pathname })
  }

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
      {/* PC: 제목줄 가운데. 캡슐(탭) + 원(알림) + 원(마이) — 폭은 --nav-w 로 정해져 있고 제목줄이 그만큼 비워 둔다 */}
      <nav
        aria-label="주 메뉴"
        className="fixed left-1/2 top-[calc(var(--demo-banner-height,0px)+0.25rem)] z-[var(--z-nav)] hidden w-[var(--nav-w)] -translate-x-1/2 items-center gap-1.5 md:flex"
      >
        <TabCapsule variant="top" activeKey={activeKey} onSelect={select} />
        <div className={cn(CIRCLE, "[&_button]:size-10 [&_button]:rounded-full")}>
          {isMdUp && <NotificationBell />}
        </div>
        <MeAvatarLink className={CIRCLE} />
      </nav>

      {/* 폰: 하단 가장자리 가변 블러 — 목록 끝이 nav 밑으로 서서히 사라진다 */}
      <div
        aria-hidden
        className={cn(
          "nav-edge-bottom pointer-events-none fixed inset-x-0 bottom-0 z-[44] h-[calc(var(--nav-offset-bottom)+12px)] md:hidden",
          keyboardOpen && "hidden"
        )}
      />
      {/* 폰: 하단 가운데. 홈 인디케이터 위로 띄운다. 캡슐(탭 넷) + 원(마이) — PC 와 같은 「캡슐 + 내 원」 짜임이다.
          마이를 다섯째 탭으로 넣지 않는다: 자주 쓰지 않는 계정 화면이 일하는 곳과 같은 무게를 갖게 된다(2026-10-29 작업지시자).
          터치 기기에서 칸은 44px 이상 — 200px 폭에서 네 칸(176px)은 들어가지만, 넘치면 캡슐 안에서 민다 */}
      <nav
        aria-label="주 메뉴"
        className={cn(
          "fixed inset-x-3 bottom-[calc(var(--safe-bottom)+8px)] z-[var(--z-nav)] flex h-[54px] items-stretch gap-2 transition-transform duration-200 motion-reduce:transition-none md:hidden",
          keyboardOpen && "pointer-events-none translate-y-[calc(100%+24px)]"
        )}
      >
        <TabCapsule variant="bottom" activeKey={activeKey} onSelect={select} />
        {/* 원의 지름 = 캡슐 높이. nav 높이를 54px 로 고정해야 정사각이 된다 — 높이가 내용으로 정해지면
            aspect-square 가 폭을 못 잡아 26px 막대가 됐다(2026-10-29 실측) */}
        <MeAvatarLink className={cn(CIRCLE, "size-auto h-full aspect-square [&>span]:size-8 [&>span]:text-[12px]")} />
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
  onSelect,
}: {
  variant: "top" | "bottom"
  activeKey: string | null
  /** 탭을 누른 순간 — 도착을 기다리지 않고 알약을 옮긴다 */
  onSelect: (key: string) => void
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
        variant === "top" ? "flex-1" : "min-w-0 flex-1 gap-0.5 overflow-x-auto rounded-[24px] [scrollbar-width:none]"
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
        const icon = (
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
            onClick={(e) => {
              // 새 탭·새 창으로 여는 클릭은 이 화면을 떠나지 않는다
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
              onSelect(tab.key)
            }}
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
