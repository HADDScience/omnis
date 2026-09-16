"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { MessageInput } from "@/components/chat/message-input"
import { apiUrl } from "@/lib/base-path"

/** 자동완성 후보 — 스레드 목록이 한 번 불러와 목록(멘션 링크)과 입력창이 같이 쓴다 */
export interface ThreadRefs {
  tasks: { id: string; name: string; slug: string; status?: string }[]
  users: { id: string; name: string }[]
  files: { id: string; name: string; path: string; mimeType: string }[]
}

interface ThreadComposerProps extends Partial<ThreadRefs> {
  taskId: string
  taskSlug?: string
  /** 메시지 게시 방 (기본 "default-room") */
  roomId?: string
  /** 메시지 작성 후 호출. 없으면 router.refresh()만 호출 */
  onSent?: () => void
  /** 보내기 누른 즉시 글을 알린다(목록에 「보내는 중」 줄). 실패하면 null */
  onPending?: (content: string | null) => void
  /** 서버가 AI 재구성을 응답 뒤로 미뤘다 — 이 메시지의 재구성이 끝날 때까지 목록에 「갱신 중」 */
  onQueued?: (messageId: string) => void
  /** 답장 대상 — 목록에서 고른 글. 보내면 비운다 */
  replyTo?: { id: string; authorName: string; content: string } | null
  onClearReply?: () => void
}

class SessionExpired extends Error {}

/**
 * 업무 스레드 입력창 — 채팅 입력창(MessageInput)을 그대로 쓴다(2026-09-14).
 * 파일은 붙여넣기 · 끌어놓기 · + 메뉴, @사람 · #업무 자동완성까지 채팅과 같다. `/업무` 명령만 뺀다.
 *
 * - taskId 가 자동으로 붙는다 — #멘션 없이도 이 업무 스레드로 간다. 다른 업무를 #멘션하면 참조로 남는다.
 * - 서버는 글을 저장하자마자 응답하고 AI 재구성은 뒤에서 돈다(2026-09-15). 입력창을 막지 않는다 —
 *   「옴니스가 업무를 갱신하고 있어요」 는 스레드 목록이 한 줄로 보여 준다.
 * - 실패하면 던진다 — MessageInput 이 쓴 글과 첨부를 비우지 않는다.
 */
export function ThreadComposer({
  taskId,
  roomId = "default-room",
  onSent,
  onPending,
  onQueued,
  replyTo,
  onClearReply,
  tasks = [],
  users = [],
  files = [],
}: ThreadComposerProps) {
  const router = useRouter()
  const [sending, setSending] = useState(false)

  async function send(content: string, attached?: File[]) {
    setSending(true)
    onPending?.(content)
    try {
      // NAS 에 먼저 올리고 받은 id 를 메시지에 붙인다 — 채팅 패널과 같은 순서
      const fileIds: string[] = []
      for (const f of attached ?? []) {
        const form = new FormData()
        form.append("file", f)
        const up = await fetch(apiUrl("/api/files"), { method: "POST", body: form })
        if (up.status === 401) throw new SessionExpired()
        if (!up.ok) {
          const err = await up.json().catch(() => ({}))
          throw new Error(err?.error ?? `「${f.name}」 을 올리지 못했습니다`)
        }
        fileIds.push((await up.json()).id)
      }

      const res = await fetch(apiUrl("/api/chat/messages"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roomId, content, taskId, fileIds, replyToId: replyTo?.id }),
      })
      if (res.status === 401) throw new SessionExpired()
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error ?? "전송 실패")
      }
      const saved = (await res.json().catch(() => null)) as { id?: string; _rebuild?: string | null } | null
      if (saved?.id && saved._rebuild === "queued") onQueued?.(saved.id)
      onClearReply?.()
      onSent?.()
      router.refresh()
    } catch (e) {
      onPending?.(null)
      if (e instanceof SessionExpired) {
        toast.error("세션이 만료되었습니다. 다시 로그인해주세요.", {
          action: { label: "로그인", onClick: () => { window.location.href = apiUrl("/login") } },
        })
      } else {
        toast.error(e instanceof Error ? e.message : "메시지 전송 실패")
      }
      throw e
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      className="relative shrink-0 border-t bg-background"
      data-thread-composer
      data-sending={sending ? "true" : "false"}
    >
      {/* 무엇에 답하는 중인지 입력창 바로 위에 둔다 — 채팅 패널과 같은 모양 */}
      {replyTo && (
        <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
          <span className="shrink-0 font-medium">{replyTo.authorName}에게 답장</span>
          <span className="min-w-0 flex-1 truncate">{replyTo.content}</span>
          <button
            type="button"
            aria-label="답장 취소"
            onClick={onClearReply}
            className="shrink-0 rounded px-1 hover:bg-muted"
          >
            ✕
          </button>
        </div>
      )}
      <MessageInput
        onSend={send}
        tasks={tasks}
        users={users}
        files={files}
        commands={false}
        ariaLabel="이 업무 스레드에 답장"
        // 슬러그를 넣으면 긴 업무명에서 두 줄로 넘친다 — 이 업무로 간다는 것은 탭 이름이 이미 말한다
        placeholder="답장 · @ 사람 · # 업무 · 파일은 끌어다 놓기"
      />
    </div>
  )
}
