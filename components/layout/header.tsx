"use client"

import { Fragment, type ReactNode } from "react"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { NotificationBell } from "./notification-bell"

interface HeaderProps {
  title?: string
  crumbs?: string[]
  actions?: ReactNode
}

export function Header({ title, crumbs, actions }: HeaderProps) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-background px-4">
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-4" />
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {crumbs && crumbs.length > 0 ? (
          crumbs.map((c, i) => (
            <Fragment key={i}>
              {i > 0 && <span className="text-xs text-muted-foreground">/</span>}
              <span
                className={
                  i === crumbs.length - 1
                    ? "truncate text-[13px] font-semibold text-foreground"
                    : "truncate text-[13px] text-muted-foreground"
                }
              >
                {c}
              </span>
            </Fragment>
          ))
        ) : title ? (
          <span className="truncate text-sm font-semibold">{title}</span>
        ) : null}
      </div>
      <div className="flex items-center gap-1">
        {actions}
        {actions && <Separator orientation="vertical" className="mx-1 h-4" />}
        <NotificationBell />
      </div>
    </header>
  )
}
