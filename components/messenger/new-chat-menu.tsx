"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { BubbleChatSparkIcon, PencilEdit02Icon, UserGroupIcon } from "@hugeicons/core-free-icons"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

/**
 * 「새 대화」 단추와 메뉴 — 누르면 두 갈래: 옴니스와 대화(/chat/new, 첫 글을 보내면 방이 생긴다) ·
 * 사람과 대화(/chat/new/people, 구성원을 고른다). 사람끼리 방에는 옴니스가 들어가지 않는다(5단계).
 * PC 는 목록 오른쪽 아래 FAB, 폰은 제목 줄 아이콘 — 단추 모양만 다르고 메뉴는 같다.
 * 메뉴가 열리는 순간 두 항목을 미리 받아 둔다 — router.push 는 링크처럼 저절로 미리 받지 않는다
 */
export function NewChatMenu({
  className,
  iconSize,
  side,
  ...trigger
}: {
  className: string
  iconSize: number
  side: "top" | "bottom"
  "data-new-chat-fab"?: boolean
  "data-new-chat-title"?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          router.prefetch("/chat/new")
          router.prefetch("/chat/new/people")
        }
      }}
    >
      <DropdownMenuTrigger aria-label="새 대화" title="새 대화" className={className} {...trigger}>
        <HugeiconsIcon icon={PencilEdit02Icon} size={iconSize} aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side={side} sideOffset={8} className="w-72 rounded-2xl p-1.5">
        <DropdownMenuItem className="touch-target gap-3 rounded-xl py-2.5" onClick={() => router.push("/chat/new")}>
          <HugeiconsIcon icon={BubbleChatSparkIcon} size={22} aria-hidden className="text-primary" />
          <span className="min-w-0 flex-1">
            <span className="block text-[15.5px] font-medium">옴니스와 대화</span>
            <span className="block text-[13px] text-muted-foreground">회사 일을 묻고 업무를 맡겨요</span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem className="touch-target gap-3 rounded-xl py-2.5" onClick={() => router.push("/chat/new/people")}>
          <HugeiconsIcon icon={UserGroupIcon} size={22} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-[15.5px] font-medium">사람과 대화</span>
            <span className="block text-[13px] text-muted-foreground">1:1 이나 단톡방 — 참여자만 봐요</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
