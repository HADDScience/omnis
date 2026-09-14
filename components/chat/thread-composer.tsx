"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Spinner } from "@/components/ui/spinner"
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
}

class SessionExpired extends Error {}

/**
 * 업무 스레드 입력창 — 채팅 입력창(MessageInput)을 그대로 쓴다(2026-09-14).
 * 파일은 붙여넣기 · 끌어놓기 · + 메뉴, @사람 · #업무 자동완성까지 채팅과 같다. `/업무` 명령만 뺀다.
 *
 * - taskId 가 자동으로 붙는다 — #멘션 없이도 이 업무 스레드로 간다. 다른 업무를 #멘션하면 참조로 남는다.
 * - 서버는 AI 재구성이 끝난 뒤 응답한다. 그동안 「옴니스가 업무를 갱신하는 중」 을 덮어 보여 준다.
 * - 실패하면 던진다 — MessageInput 이 쓴 글과 첨부를 비우지 않는다.
 */
export function ThreadComposer({
  taskId,
  roomId = "default-room",
  onSent,
  tasks = [],
  users = [],
  files = [],
}: ThreadComposerProps) {
  const router = useRouter()
  const [sending, setSending] = useState(false)

  async function send(content: string, attached?: File[]) {
    setSending(true)
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
        body: JSON.stringify({ roomId, content, taskId, fileIds }),
      })
      if (res.status === 401) throw new SessionExpired()
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error ?? "전송 실패")
      }
      onSent?.()
      router.refresh()
    } catch (e) {
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

      {/* 처리 중 오버레이 — 입력 차단 + 옴니스 처리 상태 표시 */}
      {sending && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/85 backdrop-blur-[2px]">
          <div className="flex items-center gap-2.5 rounded-lg border border-primary/30 bg-card px-4 py-2.5 shadow-lg">
            <Spinner className="h-4 w-4 text-primary" />
            <div className="leading-tight">
              <div className="text-[12px] font-semibold text-foreground">옴니스가 업무를 갱신하는 중…</div>
              <div className="text-[10.5px] text-muted-foreground">메시지를 분석해 상태·체크리스트를 재구성합니다</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
