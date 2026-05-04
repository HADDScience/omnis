"use client"

import { useEffect, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { ChatDock } from "@/components/chat/chat-dock"
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
  const [dockOpen, setDockOpen] = useState(false)

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
        return
      if (e.key === "c" || e.key === "C" || e.key === "ㅊ") {
        e.preventDefault()
        setDockOpen((prev) => !prev)
      }
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [])

  return (
    <>
      <div className="flex h-svh min-h-0 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-auto">{children}</div>
          <ChatDock
            open={dockOpen}
            setOpen={setDockOpen}
            currentUserId={currentUserId}
            initialMessages={initialMessages}
            onTaskUpdated={() => router.refresh()}
          />
        </div>
      </div>
      <CommandPalette />
    </>
  )
}
