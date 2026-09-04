"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import { BubbleChatIcon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { useRightPanel } from "./right-panel-context"

/** 헤더에 붙는 패널 여닫기 단추. 헤더는 모든 화면이 쓰므로 여기 한 번만 두면 된다. */
export function RightPanelTrigger() {
  const { open, toggle, task } = useRightPanel()
  const label = open ? "패널 닫기" : task ? `${task.name} 스레드 열기` : "채팅 열기"
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      aria-pressed={open}
      title={`${label} (C)`}
      onClick={toggle}
    >
      <HugeiconsIcon icon={BubbleChatIcon} size={17} aria-hidden />
    </Button>
  )
}
