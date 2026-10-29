"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { Notification03Icon, NotificationOff03Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { chatPrefs } from "./chat-prefs-client"
import { useRoomListReload } from "./messenger-shell"

/**
 * 방 머리줄의 「알림 끄기 / 켜기」 — 이 방의 채팅 푸시만 끈다(멘션 푸시 · 벨 · 안읽음 배지는 그대로).
 * 꺼져 있으면 종에 빗금이 그어진 채로 남아 머리줄에서 상태가 보인다. 목록 메뉴 · 밀기 칸과 같은 API 다.
 */
export function RoomMuteButton({ roomKey, initialMuted }: { roomKey: string; initialMuted: boolean }) {
  const [muted, setMuted] = useState(initialMuted)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const reloadList = useRoomListReload()

  // 목록에서 바꾸면 서버 화면이 새로 그려지며 값이 바뀌어 온다
  useEffect(() => setMuted(initialMuted), [initialMuted])

  async function toggle() {
    if (lock.current) return
    lock.current = true
    const next = !muted
    setMuted(next)
    setBusy(true)
    try {
      await chatPrefs.setMuted(roomKey, next)
      toast.success(next ? "이 방 알림을 껐어요. 나를 부른 글은 계속 알려요" : "이 방 알림을 켰어요")
      reloadList()
    } catch (err) {
      setMuted(!next)
      toast.error(err instanceof Error ? err.message : "알림 설정을 바꾸지 못했습니다")
    } finally {
      setBusy(false)
      lock.current = false
    }
  }

  const label = muted ? "이 방 알림 켜기" : "이 방 알림 끄기"
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={muted ? "touch-target text-muted-foreground" : "touch-target"}
      aria-label={label}
      aria-pressed={muted}
      title={label}
      disabled={busy}
      data-room-muted={muted ? "true" : "false"}
      onClick={() => void toggle()}
    >
      <HugeiconsIcon icon={muted ? NotificationOff03Icon : Notification03Icon} size={15} aria-hidden />
    </Button>
  )
}
