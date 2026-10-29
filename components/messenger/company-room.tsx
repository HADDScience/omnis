"use client"

import { useState, type ComponentProps } from "react"
import { useRouter } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { Search01Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { ChatPanel } from "@/components/chat/chat-panel"
import { TaskCmdModal } from "@/components/chat/task-cmd-modal"
import { RoomHeader } from "./room-header"
import { RoomMuteButton } from "./room-mute-button"

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
  muted,
}: {
  roomId: string
  roomName: string
  currentUserId: string
  initialMessages: Messages
  /** 이 방의 채팅 푸시를 껐는가(머리줄 「알림 끄기 / 켜기」 첫 상태) */
  muted: boolean
}) {
  const router = useRouter()
  const [searchOpen, setSearchOpen] = useState(false)
  const [taskModalRaw, setTaskModalRaw] = useState<string | null>(null)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RoomHeader
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
          </>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <ChatPanel
          roomId={roomId}
          initialMessages={initialMessages}
          currentUserId={currentUserId}
          onTaskUpdated={() => router.refresh()}
          searchOpen={searchOpen}
          onSearchOpenChange={setSearchOpen}
          onSlashTaskCommand={(raw) => setTaskModalRaw(raw)}
        />
      </div>
      <TaskCmdModal open={taskModalRaw !== null} rawCommand={taskModalRaw ?? ""} onClose={() => setTaskModalRaw(null)} />
    </div>
  )
}
