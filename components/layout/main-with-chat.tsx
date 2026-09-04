"use client"

import { useEffect, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { RightPanel } from "./right-panel"
import { useRightPanel } from "./right-panel-context"
import { CommandPalette } from "./command-palette"

interface Message {
  id: string
  content: string
  createdAt: string
  isTaskInstruction: boolean
  author: { id: string; name: string }
  task?: { id: string; name: string; slug: string } | null
}

interface MainWithChatProps {
  currentUserId: string
  initialMessages: Message[]
  children: ReactNode
}

export function MainWithChat({
  currentUserId,
  initialMessages,
  children,
}: MainWithChatProps) {
  const router = useRouter()
  const { open, setOpen } = useRightPanel()

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      // Cmd/Ctrl/Alt 조합(복사·붙여넣기 등)은 단축키로 가로채지 않음
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      )
        return
      if (e.key === "c" || e.key === "C" || e.key === "ㅊ") {
        e.preventDefault()
        setOpen(!open)
      }
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [open, setOpen])

  return (
    <>
      <div className="flex h-[calc(var(--app-vh)-var(--demo-banner-height,0px))] min-h-0 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-auto">{children}</div>
        </div>
        <RightPanel
          currentUserId={currentUserId}
          initialMessages={initialMessages}
          onTaskUpdated={() => router.refresh()}
        />
      </div>
      <CommandPalette />
    </>
  )
}
