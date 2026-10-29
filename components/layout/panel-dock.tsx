"use client"

import { usePathname } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { BubbleChatIcon } from "@hugeicons/core-free-icons"
import { cn } from "@/lib/utils"
import { useRightPanel } from "./right-panel-context"

/**
 * 오른쪽 대화 패널을 여는 둥근 유리 단추 — 화면 오른쪽 아래(규칙 14 의 독 사분면).
 *
 * 2026-10-29 제목줄의 「채팅 열기」 아이콘을 지우면서 옮겼다. 그대로 지우면 폰에서는 패널을 열 길이 없었다
 * (C 키 · ⌘⇧F 는 물리 키보드에서만, ?taskId= 는 링크로 들어올 때만). 업무를 보다가 그 업무 스레드 · 전사 채팅 ·
 * 옴니스를 옆에 여는 자리라, 손이 닿고 본문을 덜 가리는 오른쪽 아래에 둔다.
 *
 * 폰의 채팅 화면(/chat…)에서는 그리지 않는다 — 대화가 화면 전체이고 오른쪽 아래는 「새 대화」 단추 · 입력칸 자리다.
 * PC 의 채팅 화면에서는 입력칸 위로 올려 보내기 단추와 겹치지 않게 한다.
 */
export function PanelDock() {
  const { open, openWith, task } = useRightPanel()
  const pathname = usePathname()
  const inChat = pathname === "/chat" || pathname.startsWith("/chat/")
  if (open) return null
  const label = task ? `대화 패널 열기 — ${task.name} 스레드` : "대화 패널 열기"
  return (
    <button
      type="button"
      data-onboarding="chat-trigger"
      aria-label={label}
      title={`${label} (C)`}
      onClick={() => openWith(task ? "task" : "all")}
      className={cn(
        "glass fixed! right-4 z-[var(--z-dock)] flex size-12 items-center justify-center rounded-full text-foreground transition-transform duration-150 active:scale-[0.94] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        "bottom-[calc(var(--nav-offset-bottom)+12px)]",
        inChat && "max-md:hidden md:bottom-[96px]",
      )}
    >
      <HugeiconsIcon icon={BubbleChatIcon} size={20} aria-hidden />
    </button>
  )
}
