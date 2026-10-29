"use client"

import { Fragment, type ReactNode } from "react"
import { Separator } from "@/components/ui/separator"
import { NotificationBell } from "./notification-bell"
import { NAV_DESKTOP_QUERY } from "./floating-nav"
import { useHeaderSubnav } from "./header-subnav"
import { useMediaQuery } from "@/hooks/use-media-query"

interface HeaderProps {
  title?: string
  crumbs?: string[]
  actions?: ReactNode
}

export function Header({ title, crumbs, actions }: HeaderProps) {
  // PC 에서는 알림 종·마이 원이 떠 있는 nav 옆에 있다. 폰의 마이 원은 하단 nav 오른쪽 끝이다
  const isMdUp = useMediaQuery(NAV_DESKTOP_QUERY)
  const subnav = useHeaderSubnav()
  return (
    <>
      <header
        // h-12 는 3rem = 39px(루트 81.25%)이라 44px 터치 타깃이 안 들어간다.
        // 터치 기기에서만 헤더를 키운다 — 마우스 환경 밀도는 그대로 둔다.
        // PC 에서는 떠 있는 nav 가 이 줄 가운데에 겹친다 — 가운데 칸(--nav-w)을 비우고 제목은 왼쪽, 버튼은 오른쪽 칸에 둔다
        className="flex h-12 shrink-0 items-center gap-3 border-b bg-background px-4 md:grid md:grid-cols-[minmax(0,1fr)_var(--nav-w)_minmax(0,1fr)] [@media(pointer:coarse)]:h-[52px]"
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {crumbs && crumbs.length > 0 ? (
            crumbs.map((c, i) => {
              // 좁은 화면에서는 마지막 조각만 남긴다. 320px 에서 "CRM / 견적 /
              // HADD240924-001" 세 조각이 전부 잘려, 어느 하나도 읽히지 않았다.
              const isLast = i === crumbs.length - 1
              const hideOnNarrow = isLast ? "" : "hidden sm:inline"
              return (
                <Fragment key={i}>
                  {i > 0 && (
                    <span className={`hidden text-xs text-muted-foreground sm:inline`}>/</span>
                  )}
                  <span
                    className={
                      (isLast
                        ? "truncate text-[13px] font-semibold text-foreground"
                        : "truncate text-[13px] text-muted-foreground") +
                      (hideOnNarrow ? " " + hideOnNarrow : "")
                    }
                  >
                    {c}
                  </span>
                </Fragment>
              )
            })
          ) : title ? (
            <span className="truncate text-sm font-semibold">{title}</span>
          ) : null}
        </div>
        <div aria-hidden className="hidden md:block" />
        <div className="flex min-w-0 items-center gap-1 md:justify-self-end">
          {actions}
          {!isMdUp && (
            <>
              {actions && <Separator orientation="vertical" className="mx-1 h-4 self-center!" />}
              <NotificationBell />
            </>
          )}
        </div>
      </header>
      {subnav}
    </>
  )
}
