"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { apiUrl } from "@/lib/base-path"
import { FEEDBACK_KINDS, type FeedbackKind } from "@/lib/feedback"
import { cn } from "@/lib/utils"

/**
 * 앱 정보의 「문의·의견 보내기」 — 옴니스가 받는 기능 요청과 같은 곳(관리 화면 /settings/feature-requests,
 * 받는 사람은 관리자 화면에서 지정한 사람 · 없으면 운영 알림 메일 주소의 계정)으로 바로 간다(app/api/feedback).
 */
export function FeedbackDialog() {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<FeedbackKind>("idea")
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)

  async function send() {
    if (!text.trim() || sending) return
    setSending(true)
    try {
      const res = await fetch(apiUrl("/api/feedback"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, text }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        toast.error(body?.error ?? "보내지 못했습니다. 잠시 뒤 다시 시도하세요")
        return
      }
      toast.success("보냈습니다. 고마워요!")
      setText("")
      setOpen(false)
    } catch {
      toast.error("보내지 못했습니다. 연결을 확인하세요")
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        data-feedback-open
        className="touch-target flex w-full items-center justify-center rounded-xl border bg-card px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/60"
      >
        문의·의견 보내기
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>문의·의견 보내기</DialogTitle>
          <DialogDescription>옴니스를 만드는 사람에게 바로 갑니다. 보낸 사람 이름이 함께 갑니다.</DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label="종류" className="flex flex-wrap gap-1.5">
          {FEEDBACK_KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              role="radio"
              aria-checked={kind === k.id}
              onClick={() => setKind(k.id)}
              className={cn(
                "touch-target rounded-full border px-3 py-1 text-[12.5px] transition-colors",
                kind === k.id ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted"
              )}
            >
              {k.label}
            </button>
          ))}
        </div>
        <Textarea
          aria-label="내용"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          rows={5}
          placeholder={FEEDBACK_KINDS.find((k) => k.id === kind)?.placeholder}
          className="text-[14px]"
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            닫기
          </Button>
          <Button onClick={send} disabled={!text.trim() || sending}>
            {sending ? "보내는 중…" : "보내기"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
