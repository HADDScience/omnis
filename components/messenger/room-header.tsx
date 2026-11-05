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
  capsule = false,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  link?: { href: string; label: string }
  /** 폰에서 뒤로 · 동작을 유리 캡슐로 두고 제목을 가운데에 둔다(전사 · 사람 방). PC 모양은 그대로다 */
  capsule?: boolean
}) {
  const startEntry = useStartRoomEntry()
  return (
    <div className={cn("flex min-h-[64px] shrink-0 items-center gap-2 border-b px-2 py-1.5 md:px-5", capsule && "max-md:absolute max-md:inset-x-0 max-md:top-0 max-md:z-[3] max-md:isolate max-md:h-[56px] max-md:min-h-[56px] max-md:border-b-0 max-md:px-[10px]")} data-room-header>
      {/* 글이 머리 뒤로 지나간다 — 위는 바탕으로 덮어 제목 대비를 지키고 아래로 흐려진다 */}
      {capsule && <div aria-hidden className="room-edge-top pointer-events-none absolute inset-x-0 top-0 -z-10 hidden h-[76px] max-md:block" />}
      <Link
        href="/chat"
        // 목록(/chat)에서 방을 막 누른 입장 화면이면 주소가 그대로라 이동만으로는 화면이 안 바뀐다 — 덮개를 걷는다
        onClick={() => startEntry(null)}
        aria-label="채팅방 목록으로"
        className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "touch-target size-11 md:hidden", capsule && "glass rounded-full")}
      >
        <HugeiconsIcon icon={ArrowLeft01Icon} size={26} aria-hidden className="size-[26px]" />
      </Link>
      <div className={cn("min-w-0 flex-1", capsule && "max-md:text-center")}>
        <h1 className={cn("truncate text-[18px] leading-tight font-semibold", capsule && "max-md:text-[16px]")}>{title}</h1>
        {subtitle && <p className={cn("mt-0.5 truncate text-[13.5px] text-muted-foreground", capsule && "max-md:hidden")}>{subtitle}</p>}
      </div>
      {(actions || link) && (
        <div
          data-room-actions
          className={cn(
            "flex shrink-0 items-center gap-1 [&_button]:min-h-[46px] [&_button]:min-w-[46px] [&_button]:text-[14.5px] [&_button_svg]:size-[22px]!",
            capsule && "max-md:glass max-md:gap-0 max-md:rounded-full max-md:[&_button]:min-h-[44px] max-md:[&_button]:min-w-[44px] max-md:[&_button]:rounded-full",
          )}
        >
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
