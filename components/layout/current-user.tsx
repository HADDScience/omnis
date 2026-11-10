"use client"

import { createContext, useContext, useState, type ReactNode } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { LinkPendingMark } from "@/components/ui/pending-link"
import { cn } from "@/lib/utils"

/** 로그인한 사람의 이름. 클라이언트 세션(SessionProvider)을 두지 않아 레이아웃이 서버에서 읽어 내려 준다 */
const CurrentUserContext = createContext<{ name: string | null }>({ name: null })

export function CurrentUserProvider({ name, children }: { name: string | null; children: ReactNode }) {
  return <CurrentUserContext.Provider value={{ name }}>{children}</CurrentUserContext.Provider>
}

export function useCurrentUser() {
  return useContext(CurrentUserContext)
}

/**
 * 마이(계정·설정)로 가는 아바타. 설정은 가끔 쓰는 곳이라 탭 한 칸을 주지 않고 동그라미로 뺐다 —
 * Apple·Linear 탭바도 프로필을 탭에 두지 않는다. PC 는 떠 있는 nav 옆, 폰은 하단 nav 의 탭 캡슐 오른쪽(2026-10-29 제목줄에서 옮김).
 */
export function MeAvatarLink({ className }: { className?: string }) {
  const { name } = useCurrentUser()
  const pathname = usePathname()
  const router = useRouter()
  // 누른 순간 켠다 — 주소는 마이 화면이 그려진 뒤에야 바뀌어, 그것만 보면 누른 뒤 한참 아무 변화가 없었다
  // (2026-10-29 작업지시자 「프로필로 갈 때 블로킹」). 도착하면(주소가 바뀌면) 내려놓는다
  const [pressedAt, setPressedAt] = useState<string | null>(null)
  if (pressedAt && pressedAt !== pathname) setPressedAt(null)
  const active = pathname === "/settings" || pathname.startsWith("/settings/") || pressedAt !== null
  // 손가락이 닿거나 마우스가 올라오는 순간 마이 화면(스켈레톤까지)을 미리 받는다 — dev 처럼 링크가 저절로
  // 미리 받지 않는 곳에서도 누른 뒤 서버를 기다리지 않게
  const warm = () => router.prefetch("/settings")
  return (
    <Link
      href="/settings"
      prefetch
      onPointerEnter={warm}
      onPointerDown={warm}
      onFocus={warm}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
        if (!pathname.startsWith("/settings")) setPressedAt(pathname)
      }}
      data-onboarding="profile"
      aria-label="마이 — 계정·설정"
      title="마이 — 계정·설정"
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        "transition-transform duration-150 active:scale-[0.94] has-data-[pending]:scale-[0.94] motion-reduce:transition-none",
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-[26px] items-center justify-center rounded-full text-[11px] font-semibold transition-colors",
          active ? "bg-foreground text-background" : "bg-muted-foreground/20 text-foreground"
        )}
      >
        {name?.charAt(0) ?? "?"}
      </span>
      <LinkPendingMark />
    </Link>
  )
}
