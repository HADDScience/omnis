"use client"

import { useEffect, useState, type ComponentProps } from "react"
import { useRouter } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { Search01Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { ChatPanel } from "@/components/chat/chat-panel"
import { TaskCmdModal } from "@/components/chat/task-cmd-modal"
import { RoomHeader } from "./room-header"
import { RoomMuteButton } from "./room-mute-button"
import { RoomDrawerButton, useRoomDrawer } from "./room-drawer-button"

type Messages = ComponentProps<typeof ChatPanel>["initialMessages"]

/**
 * 전사방 — 오른쪽 패널 「전체」 와 같은 ChatPanel 을 메신저 가운데 칸에 그린다(폴링 · 검색 · / 업무 명령 · 답장 그대로).
 * 따로 그리면 두 화면의 팀 채팅이 다시 어긋난다(ux-rules 「채팅 메시지 목록」).
 */
export function CompanyRoom({
  roomId,
  roomName,
  currentUserId,
  initialMessages,
  resume,
  muted,
  live,
  searchRequest,
}: {
  roomId: string
  roomName: string
  currentUserId: string
  initialMessages: Messages
  /** initialMessages 가 반영한 서버 시각 — ChatPanel 이 비우지 않고 그 뒤의 변경만 받는다 */
  resume?: ComponentProps<typeof ChatPanel>["resume"]
  /** 이 방의 채팅 푸시를 껐는가(머리줄 「알림 끄기 / 켜기」 첫 상태) */
  muted: boolean
  /** 서버 페이지 없이 그린 방(client-room.tsx) */
  live?: ComponentProps<typeof ChatPanel>["live"]
  /** 오른쪽 패널의 ⌘⇧F — 오를 때마다 검색 줄을 열고 검색칸을 고른다 */
  searchRequest?: number
}) {
  const router = useRouter()
  const [searchOpen, setSearchOpen] = useState(false)
  const drawer = useRoomDrawer(roomName)
  const [searchFocus, setSearchFocus] = useState(0)
  useEffect(() => {
    if (!searchRequest) return
    setSearchOpen(true)
    setSearchFocus((n) => n + 1)
  }, [searchRequest])
  const [taskModalRaw, setTaskModalRaw] = useState<string | null>(null)

  return (
    <div data-chat-room-chrome className="relative flex min-h-0 flex-1 flex-col">
      <RoomHeader
        capsule
        title={roomName}
        subtitle="전사방 · 구성원 모두 · #업무 로 업무 스레드에 글을 남깁니다"
        actions={
          <>
            <RoomMuteButton roomKey={`room:${roomId}`} initialMuted={muted} />
            <Button
              variant="ghost"
              size="icon-sm"
              className="touch-target"
              aria-label="채팅 검색"
              aria-pressed={searchOpen}
              title="채팅 검색"
              onClick={() => setSearchOpen((v) => !v)}
            >
              <HugeiconsIcon icon={Search01Icon} size={15} aria-hidden />
            </Button>
            <RoomDrawerButton drawer={drawer} />
          </>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <ChatPanel
          drawer={drawer}
          roomId={roomId}
          live={live}
          // 방을 여는 동안 쓴 글을 이어받는다 — 사람 방 · 업무 방과 같다(lib/chat-entry.ts)
          handoffKey={`room:${roomId}`}
          initialMessages={initialMessages}
          resume={resume}
          currentUserId={currentUserId}
          onTaskUpdated={() => router.refresh()}
          searchOpen={searchOpen}
          onSearchOpenChange={setSearchOpen}
          searchFocus={searchFocus}
          onSlashTaskCommand={(raw) => setTaskModalRaw(raw)}
        />
      </div>
      <TaskCmdModal open={taskModalRaw !== null} rawCommand={taskModalRaw ?? ""} onClose={() => setTaskModalRaw(null)} />
    </div>
  )
}
