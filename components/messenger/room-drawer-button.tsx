"use client"

// 방 머리 오른쪽 ≡ — 서랍을 연다. 상태는 방 화면이 들고 ChatPanel(→ 사진 뷰어 곁의 서랍)에 넘긴다
import { useMemo, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Menu01Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import type { DrawerControl } from "@/components/photo-viewer/chat-photo-viewer"
import type { DrawerTab } from "@/lib/room-drawer"

export function useRoomDrawer(roomName: string): DrawerControl {
  const [state, setState] = useState<{ open: boolean; tab: DrawerTab }>({ open: false, tab: "photos" })
  return useMemo(
    () => ({
      roomName,
      open: state.open,
      tab: state.tab,
      onOpen: (tab: DrawerTab) => setState({ open: true, tab }),
      onClose: () => setState((s) => ({ ...s, open: false })),
    }),
    [roomName, state],
  )
}

export function RoomDrawerButton({ drawer }: { drawer: DrawerControl }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="touch-target"
      aria-label="서랍 — 사진 · 파일 · 링크 · 참여자"
      aria-expanded={drawer.open}
      title="서랍"
      data-room-drawer-button
      onClick={() => (drawer.open ? drawer.onClose() : drawer.onOpen(drawer.tab))}
    >
      <HugeiconsIcon icon={Menu01Icon} size={15} aria-hidden />
    </Button>
  )
}
