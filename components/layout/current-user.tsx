"use client"

import { createContext, useContext, type ReactNode } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
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
 * Apple·Linear 탭바도 프로필을 탭에 두지 않는다. PC 는 떠 있는 nav 옆, 폰은 페이지 제목줄 오른쪽.
 */
export function MeAvatarLink({ className }: { className?: string }) {
  const { name } = useCurrentUser()
  const pathname = usePathname()
  const active = pathname === "/settings" || pathname.startsWith("/settings/")
  return (
    <Link
      href="/settings"
      data-onboarding="profile"
      aria-label="마이 — 계정·설정"
      title="마이 — 계정·설정"
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-[26px] items-center justify-center rounded-full text-[11px] font-semibold",
          active ? "bg-foreground text-background" : "bg-muted-foreground/20 text-foreground"
        )}
      >
        {name?.charAt(0) ?? "?"}
      </span>
    </Link>
  )
}
