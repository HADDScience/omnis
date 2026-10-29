"use client"

import { createContext, useCallback, useContext, useState, type ReactNode } from "react"
import { usePathname, useRouter } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { BubbleChatSparkIcon, PencilEdit02Icon, UserGroupIcon } from "@hugeicons/core-free-icons"
import { Header } from "@/components/layout/header"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { RoomList } from "./room-list"

/** 방 화면이 목록을 다시 읽게 할 때 — 새 대화를 만들었거나 답을 받아 순서가 바뀌었을 때 */
const RoomListReload = createContext<() => void>(() => {})
export const useRoomListReload = () => useContext(RoomListReload)

/** 메신저를 보는 사람 — 기기 저장(lib/chat-cache.ts)의 키. 메신저 밖(오른쪽 패널)에서는 빈 값이라 저장하지 않는다 */
const ChatUser = createContext<string>("")
export const useChatUserId = () => useContext(ChatUser)

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
    <ChatUser.Provider value={userId}>
    <RoomListReload.Provider value={reload}>
      <div className="flex h-full min-h-0 flex-col">
        <Header title="채팅" />
        <div className="flex min-h-0 flex-1">
          <aside
            aria-label="채팅방 목록"
            className={cn(
              "relative min-h-0 w-full flex-col border-r md:flex md:w-[280px] md:shrink-0 lg:w-[300px]",
              atList ? "flex" : "hidden",
            )}
          >
            <RoomList version={version} userId={userId} />
            <NewChatFab />
          </aside>
          <section className={cn("min-h-0 min-w-0 flex-1 flex-col md:flex", atList ? "hidden" : "flex")}>
            {children}
          </section>
        </div>
      </div>
    </RoomListReload.Provider>
    </ChatUser.Provider>
  )
}

/**
 * 「새 대화」 — 채팅 목록 오른쪽 아래의 둥근 유리 단추(FAB). 누르면 두 갈래: 옴니스와 대화(/chat/new, 첫 글을 보내면
 * 방이 생긴다) · 사람과 대화(/chat/new/people, 구성원을 고른다). 사람끼리 방에는 옴니스가 들어가지 않는다(5단계).
 *
 * 2026-10-29 제목줄의 「새 대화」 버튼을 여기로 옮겼다(작업지시자). 모양은 nav 의 리퀴드 글래스(.glass) —
 * 목록 칸 안에 두므로 셸(MainWithChat)이 비워 둔 --nav-offset-bottom 위에 뜬다. 하단 nav 와 겹치지 않는다.
 * 메뉴가 열리는 순간 두 항목을 미리 받아 둔다 — router.push 는 링크처럼 저절로 미리 받지 않는다
 */
function NewChatFab() {
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
      <DropdownMenuTrigger
        aria-label="새 대화"
        title="새 대화"
        data-new-chat-fab
        className={cn(
          "glass absolute! right-4 bottom-4 z-[var(--z-dock)] flex size-14 items-center justify-center rounded-full text-foreground transition-transform duration-150 active:scale-[0.94] data-[popup-open]:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        )}
      >
        <HugeiconsIcon icon={PencilEdit02Icon} size={22} aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" sideOffset={8} className="w-60 rounded-2xl p-1.5">
        <DropdownMenuItem className="touch-target gap-2.5 rounded-xl py-2" onClick={() => router.push("/chat/new")}>
          <HugeiconsIcon icon={BubbleChatSparkIcon} size={16} aria-hidden className="text-primary" />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium">옴니스와 대화</span>
            <span className="block text-[11px] text-muted-foreground">회사 일을 묻고 업무를 맡겨요</span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem className="touch-target gap-2.5 rounded-xl py-2" onClick={() => router.push("/chat/new/people")}>
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
