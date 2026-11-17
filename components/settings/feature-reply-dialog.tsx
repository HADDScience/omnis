"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { apiUrl } from "@/lib/base-path"

/**
 * 완료 알림의 「답장」 — 써 본 사람이 불편한 점을 남긴다. 문의·의견 보내기(app/api/feedback)와 같은 곳으로,
 * replyTo 로 그 기능 요청에 잇는다. 그 요청을 남긴 사람만 보낼 수 있다(서버가 본다).
 */
export function FeatureReplyDialog({ replyTo, onClose }: { replyTo: { requestId: string; title: string } | null; onClose: () => void }) {
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)

  async function send() {
    if (!replyTo || !text.trim() || sending) return
    setSending(true)
    try {
      const res = await fetch(apiUrl("/api/feedback"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replyTo: replyTo.requestId, text }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        toast.error(body?.error ?? "보내지 못했습니다. 잠시 뒤 다시 시도하세요")
        return
      }
      toast.success("보냈습니다. 고마워요!")
      setText("")
      onClose()
    } catch {
      toast.error("보내지 못했습니다. 연결을 확인하세요")
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={replyTo !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md" data-feature-reply-dialog>
        <DialogHeader>
          <DialogTitle>답장</DialogTitle>
          <DialogDescription>
            「{replyTo?.title}」 을 써 보고 불편한 점 · 바라는 점을 적어 주세요. 만든 사람에게 바로 갑니다.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          aria-label="답장 내용"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          rows={5}
          placeholder="어느 화면에서 무엇을 하다가 어땠는지"
          className="text-[14px]"
        />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
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
