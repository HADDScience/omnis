"use client"

import { createContext, useCallback, useContext, useState, type ReactNode } from "react"
import { usePathname, useRouter } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { BubbleChatSparkIcon, PencilEdit02Icon, UserGroupIcon } from "@hugeicons/core-free-icons"
import { Header } from "@/components/layout/header"
import { buttonVariants } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { RoomList } from "./room-list"

/** 방 화면이 목록을 다시 읽게 할 때 — 새 대화를 만들었거나 답을 받아 순서가 바뀌었을 때 */
const RoomListReload = createContext<() => void>(() => {})
export const useRoomListReload = () => useContext(RoomListReload)

/**
 * 메신저 셸 — 왼쪽 방 목록 + 가운데 대화. 카톡 PC 처럼 목록은 사이드바가 아니라 이 화면 안의 왼쪽 칸이다.
 *
 * 폰(< md)에서는 둘 중 하나만 보인다: /chat 은 목록, 방 주소(/chat/…)는 대화. 대화 머리의 ← 가 목록으로 돌아간다.
 * 두 모양은 CSS 로만 가른다 — 경로는 서버도 알아서 첫 화면이 어긋나지 않는다.
 *
 * 높이는 MainWithChat 스크롤 칸 안에서 h-full 이다. 그 칸이 nav 높이(--nav-offset-*)를 이미 비워 두므로 여기서 다시 빼지 않는다.
 */
export function MessengerShell({ children, userId }: { children: ReactNode; userId: string }) {
  const pathname = usePathname()
  const atList = pathname === "/chat"
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((v) => v + 1), [])

  return (
    <RoomListReload.Provider value={reload}>
      <div className="flex h-full min-h-0 flex-col">
        <Header
          title="채팅"
          actions={<NewChatMenu />}
        />
        <div className="flex min-h-0 flex-1">
          <aside
            aria-label="채팅방 목록"
            className={cn(
              "min-h-0 w-full flex-col border-r md:flex md:w-[280px] md:shrink-0 lg:w-[300px]",
              atList ? "flex" : "hidden",
            )}
          >
            <RoomList version={version} userId={userId} />
          </aside>
          <section className={cn("min-h-0 min-w-0 flex-1 flex-col md:flex", atList ? "hidden" : "flex")}>
            {children}
          </section>
        </div>
      </div>
    </RoomListReload.Provider>
  )
}

/**
 * 「새 대화」 — 두 갈래. 옴니스와 대화(/chat/new, 첫 글을 보내면 방이 생긴다) · 사람과 대화(/chat/new/people, 구성원을 고른다).
 * 사람끼리 방에는 옴니스가 들어가지 않는다(5단계, 작업지시자 결정 2026-10-29)
 */
function NewChatMenu() {
  const router = useRouter()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "touch-target gap-1.5 text-[12.5px]")}
        title="새 대화"
      >
        <HugeiconsIcon icon={PencilEdit02Icon} size={15} aria-hidden />
        <span className="max-[359px]:sr-only">새 대화</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem className="touch-target gap-2.5 py-2" onClick={() => router.push("/chat/new")}>
          <HugeiconsIcon icon={BubbleChatSparkIcon} size={16} aria-hidden className="text-primary" />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium">옴니스와 대화</span>
            <span className="block text-[11px] text-muted-foreground">회사 일을 묻고 업무를 맡겨요</span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem className="touch-target gap-2.5 py-2" onClick={() => router.push("/chat/new/people")}>
          <HugeiconsIcon icon={UserGroupIcon} size={16} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium">사람과 대화</span>
            <span className="block text-[11px] text-muted-foreground">1:1 이나 단톡방 — 참여자만 봐요</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
