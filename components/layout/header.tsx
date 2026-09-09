"use client"

import { Fragment, type ReactNode } from "react"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { NotificationBell } from "./notification-bell"
import { RightPanelTrigger } from "./right-panel-trigger"

interface HeaderProps {
  title?: string
  crumbs?: string[]
  actions?: ReactNode
}

export function Header({ title, crumbs, actions }: HeaderProps) {
  return (
    <header
      // h-12 는 3rem = 39px(루트 81.25%)이라 44px 터치 타깃이 안 들어간다.
      // 터치 기기에서만 헤더를 키운다 — 마우스 환경 밀도는 그대로 둔다.
      className="flex h-12 shrink-0 items-center gap-3 border-b bg-background px-4 [@media(pointer:coarse)]:h-[52px]"
    >
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-4 self-center!" />
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
      <div className="flex items-center gap-1">
        {actions}
        <RightPanelTrigger />
        {actions && <Separator orientation="vertical" className="mx-1 h-4 self-center!" />}
        <NotificationBell />
      </div>
    </header>
  )
}
