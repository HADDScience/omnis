"use client"

import { useState, type KeyboardEvent } from "react"
import { useRouter } from "next/navigation"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { HugeiconsIcon } from "@hugeicons/react"
import { Sent02Icon } from "@hugeicons/core-free-icons"
import { toast } from "sonner"

interface ThreadComposerProps {
  taskId: string
  taskSlug?: string
  /** 메시지 게시 방 (기본 "default-room") */
  roomId?: string
  /** 메시지 작성 후 호출 (optimistic UI 갱신 등). 없으면 router.refresh()만 호출 */
  onSent?: () => void
}

/**
 * 업무 상세 사이드바에 내장되는 스레드 Composer (#10).
 * omnis/CLAUDE.md 규칙 18 (메시지 List는 Composer 동반 필수).
 *
 * - taskId가 자동 주입됨 (사용자가 매번 #업무명 멘션 안 해도 됨)
 * - Cmd/Ctrl + Enter 전송
 * - 빈 메시지 차단
 */
export function ThreadComposer({
  taskId,
  taskSlug,
  roomId = "default-room",
  onSent,
}: ThreadComposerProps) {
  const router = useRouter()
  const [value, setValue] = useState("")
  const [sending, setSending] = useState(false)

  async function send() {
    const content = value.trim()
    if (!content || sending) return
    setSending(true)
    try {
      const res = await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          roomId,
          content,
          taskId, // 자동 주입 → 멘션 없이도 이 업무 스레드로 연결
        }),
      })
      if (!res.ok) throw new Error("전송 실패")
      setValue("")
      onSent?.()
      router.refresh()
    } catch {
      toast.error("메시지 전송 실패")
    } finally {
      setSending(false)
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Cmd/Ctrl + Enter 전송 (Enter는 줄바꿈 보존)
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void send()
      }}
      className="flex flex-col gap-1.5 border-t bg-background p-2.5"
    >
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKey}
        placeholder={taskSlug ? `#${taskSlug} 답장 (⌘+Enter)` : "답장 (⌘+Enter)"}
        className="min-h-[60px] resize-none text-[12.5px] leading-relaxed"
        aria-label="이 업무 스레드에 답장"
      />
      <div className="flex items-center justify-between">
        <span className="text-[10.5px] text-muted-foreground">
          ⌘+Enter 전송 · 이 업무 스레드로 자동 연결
        </span>
        <Button
          type="submit"
          size="sm"
          className="h-7 gap-1 text-[11.5px]"
          disabled={sending || value.trim().length === 0}
        >
          {sending ? <Spinner className="h-3 w-3" /> : <HugeiconsIcon icon={Sent02Icon} size={11} />}
          전송
        </Button>
      </div>
    </form>
  )
}
