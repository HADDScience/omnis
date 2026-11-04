"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useStartRoomEntry } from "./messenger-context"

/**
 * 대화 칸 머리 — 방 이름 · 부제 · 동작. 폰에서는 ← 로 목록에 돌아간다(PC 는 목록이 옆에 있어 감춘다).
 * 메신저 안에서만 쓴다 — 2026-10-30 크기를 키웠다(머리 64px · 제목 18px · 단추 46px). 동작 단추는 방마다 넘기므로 감싼 칸에서 한꺼번에 키운다.
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
  const startEntry = useStartRoomEntry()
  return (
    <div className="flex min-h-[64px] shrink-0 items-center gap-2 border-b px-2 py-1.5 md:px-5">
      <Link
        href="/chat"
        // 목록(/chat)에서 방을 막 누른 입장 화면이면 주소가 그대로라 이동만으로는 화면이 안 바뀐다 — 덮개를 걷는다
        onClick={() => startEntry(null)}
        aria-label="채팅방 목록으로"
        className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "touch-target size-11 md:hidden")}
      >
        <HugeiconsIcon icon={ArrowLeft01Icon} size={26} aria-hidden className="size-[26px]" />
      </Link>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[18px] leading-tight font-semibold">{title}</h1>
        {subtitle && <p className="mt-0.5 truncate text-[13.5px] text-muted-foreground">{subtitle}</p>}
      </div>
      {(actions || link) && (
        <div className="flex shrink-0 items-center gap-1 [&_button]:min-h-[46px] [&_button]:min-w-[46px] [&_button]:text-[14.5px] [&_button_svg]:size-[22px]!">
          {actions}
          {link && (
            <Link href={link.href} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "touch-target h-[42px] px-3.5 text-[14px]")}>
              {link.label}
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
