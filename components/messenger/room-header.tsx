"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * 대화 칸 머리 — 방 이름 · 부제 · 동작. 폰에서는 ← 로 목록에 돌아간다(PC 는 목록이 옆에 있어 감춘다).
 * 클라이언트 컴포넌트다 — buttonVariants 가 클라이언트 모듈이라 서버 페이지는 버튼 모양 링크를 `link` 로 넘긴다.
 */
export function RoomHeader({
  title,
  subtitle,
  actions,
  link,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  link?: { href: string; label: string }
}) {
  return (
    <div className="flex min-h-11 shrink-0 items-center gap-1.5 border-b px-2 py-1 md:px-4">
      <Link
        href="/chat"
        aria-label="채팅방 목록으로"
        className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "touch-target md:hidden")}
      >
        <HugeiconsIcon icon={ArrowLeft01Icon} size={18} aria-hidden />
      </Link>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[14px] font-semibold">{title}</h1>
        {subtitle && <p className="truncate text-[11.5px] text-muted-foreground">{subtitle}</p>}
      </div>
      {(actions || link) && (
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          {link && (
            <Link href={link.href} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "touch-target text-[12px]")}>
              {link.label}
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
