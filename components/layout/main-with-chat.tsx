"use client"

import type { ReactNode } from "react"
import { useRouter } from "next/navigation"
import { RightPanel } from "./right-panel"
import { useRightPanel } from "./right-panel-context"
import { PanelDock } from "./panel-dock"
import { NAV_DESKTOP_QUERY } from "./floating-nav"
import { useShortcut } from "@/hooks/use-shortcuts"

interface MainWithChatProps {
  currentUserId: string
  children: ReactNode
}

export function MainWithChat({
  currentUserId,
  children,
}: MainWithChatProps) {
  const router = useRouter()
  const { open, setOpen } = useRightPanel()

  // md 미만에는 패널이 없다 — 물리 키보드를 붙인 폰 · 좁은 창의 단축키는 채팅 탭으로 간다
  useShortcut("togglePanel", () => {
    if (window.matchMedia(NAV_DESKTOP_QUERY).matches) setOpen(!open)
    else router.push("/chat")
  })

  return (
    <>
      {/* px-safe: 가로 모드 노치·펀치홀 영역을 피한다 (viewportFit: cover) */}
      <div className="px-safe flex h-[calc(var(--app-vh)-var(--demo-banner-height,0px))] min-h-0 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col">
          {/* 떠 있는 nav 밑에 내용이 깔리지 않게 그 높이만큼 비운다. 업무 보드처럼 화면 높이에 묶인 화면도
              이 칸 안에서 높이를 재므로, 여백은 각 화면이 아니라 여기 한 곳에서 준다.
              폰의 채팅 목록 · 전사 · 사람 방은 예외다 — 내용이 nav 뒤로 지나가고, 끝 여백은 그 화면이 스스로 둔다(MessengerShell · RoomList · ChatPanel) */}
          <div data-main-scroll className="flex-1 overflow-auto pt-[var(--nav-offset-top)] pb-[calc(var(--nav-offset-bottom)+var(--notice-reserve,0px))] max-md:has-[[data-chat-at-list]]:pb-0 max-md:has-[[data-chat-room-chrome]]:pb-0">{children}</div>
        </div>
        <RightPanel currentUserId={currentUserId} />
      </div>
      <PanelDock />
    </>
  )
}
