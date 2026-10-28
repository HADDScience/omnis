"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowUp01Icon, BubbleChatSparkIcon, Refresh01Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { DayDivider, MessageTime } from "@/components/chat/message-parts"
import { MESSAGE_ENTER } from "@/components/chat/message-list"
import { OmnisAnswerBody } from "@/components/omnis/omnis-ask"
import { layoutMessages, tidyBody } from "@/lib/chat-layout"
import { apiUrl } from "@/lib/base-path"
import { OMNIS_MESSAGE_MAX } from "@/lib/schemas/chat-room"
import { cn } from "@/lib/utils"
import type { OmnisRoomMessage } from "@/lib/omnis-room"
import { RoomHeader } from "./room-header"
import { useRoomListReload } from "./messenger-shell"

const EXAMPLES = [
  "이번 주 마감인 업무 정리해 줘",
  "멈춰 있는 업무와 담당자 알려줘",
  "보유한 특허와 상표 현황은?",
  "올해 정부과제 목록 보여 줘",
]

/**
 * 옴니스 1:1 방. roomId 가 null 이면 「새 대화」 — 첫 글을 보내는 순간 방이 생기고 그 주소로 옮긴다.
 *
 * 한 번 묻고 끝나던 오른쪽 패널 질문과 달리 앞의 대화가 다음 질문의 문맥이 된다(서버 lib/omnis-room.ts).
 * 지금은 읽기만 한다 — 업무를 만들거나 고치는 일은 3단계(확인 카드)에서 연다.
 */
export function OmnisRoom({
  roomId,
  roomName,
  initialMessages,
}: {
  roomId: string | null
  roomName?: string
  initialMessages: OmnisRoomMessage[]
}) {
  const router = useRouter()
  const reloadList = useRoomListReload()
  const [messages, setMessages] = useState(initialMessages)
  const [draft, setDraft] = useState("")
  /** 보내는 중인 글 — 서버가 질문 글을 돌려주기 전까지 옅게 보인다 */
  const [pending, setPending] = useState<string | null>(null)
  /** 다시 묻는 중인 글 id */
  const [retrying, setRetrying] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [mountedAt] = useState(() => Date.now())
  const busy = pending !== null || retrying !== null

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, pending, retrying, error])

  // 답을 못 받은 내 글 — 마지막 글이 내 질문이면 「다시 묻기」 를 단다(새로고침해도 남는다)
  const last = messages.at(-1)
  const unanswered = last && !last.fromOmnis && !busy ? last : null

  async function send(raw: string) {
    const content = raw.trim()
    if (content.length < 2) {
      toast.error("2자 이상 입력해 주세요")
      return
    }
    if (busy) return
    setPending(content)
    setError(null)
    // 보낸 글은 입력창에서 바로 비운다. 질문 글이 서버에 남지 못하고 실패하면 되돌려 놓는다
    setDraft("")
    let kept = false
    let navigating = false
    try {
      if (roomId === null) {
        const res = await fetch(apiUrl("/api/chat/rooms"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        })
        const data = (await res.json().catch(() => null)) as
          | { room?: { id: string }; messages?: OmnisRoomMessage[]; error?: string }
          | null
        if (!res.ok || !data?.room) throw new Error(data?.error ?? `대화를 만들지 못했습니다 (${res.status})`)
        kept = true
        if (data.error) toast.error(data.error)
        reloadList()
        // 새 방 주소로 — 그 화면이 방금 남긴 글을 DB 에서 다시 그린다. 답을 못 받았으면 거기서 「다시 묻기」 가 뜬다.
        // 옮겨 갈 때까지 보내는 중 표시를 그대로 둔다 — 지우면 빈 「새 대화」 가 한 번 번쩍인다
        navigating = true
        router.replace(`/chat/${data.room.id}`)
        return
      }
      const res = await fetch(apiUrl(`/api/chat/rooms/${roomId}/ask`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      })
      const data = (await res.json().catch(() => null)) as
        | { messages?: OmnisRoomMessage[]; question?: OmnisRoomMessage | null; error?: string }
        | null
      if (!res.ok) {
        // 질문 글은 남았다 — 방에 붙이고 그 아래에 다시 묻기를 띄운다
        if (data?.question) {
          kept = true
          setMessages((prev) => [...prev, data.question!])
        }
        throw new Error(data?.error ?? `답을 받지 못했습니다 (${res.status})`)
      }
      kept = true
      setMessages((prev) => [...prev, ...(data?.messages ?? [])])
      reloadList()
    } catch (err) {
      const message = err instanceof Error ? err.message : "보내지 못했습니다"
      if (!kept) setDraft(content)
      setError(message)
      toast.error(message)
    } finally {
      if (!navigating) {
        setPending(null)
        textareaRef.current?.focus()
      }
    }
  }

  async function retry(id: string) {
    if (!roomId || busy) return
    setRetrying(id)
    setError(null)
    try {
      const res = await fetch(apiUrl(`/api/chat/rooms/${roomId}/ask`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retryOf: id }),
      })
      const data = (await res.json().catch(() => null)) as { messages?: OmnisRoomMessage[]; error?: string } | null
      if (!res.ok) throw new Error(data?.error ?? `답을 받지 못했습니다 (${res.status})`)
      const answer = data?.messages?.find((m) => m.fromOmnis)
      if (answer) setMessages((prev) => [...prev, answer])
      reloadList()
    } catch (err) {
      const message = err instanceof Error ? err.message : "다시 묻지 못했습니다"
      setError(message)
      toast.error(message)
    } finally {
      setRetrying(null)
    }
  }

  const rows = layoutMessages(messages.map((m) => ({ ...m, author: { id: m.fromOmnis ? "omnis" : "me", name: "" } })))
  const isNew = roomId === null && messages.length === 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RoomHeader
        title={isNew ? "새 대화" : (roomName ?? "옴니스")}
        subtitle={isNew ? "옴니스와 1:1 · 첫 글을 보내면 대화방이 생깁니다" : "옴니스와 1:1 · 앞의 대화를 이어서 답합니다"}
      />

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex w-full max-w-[760px] flex-col px-3 py-4 sm:px-6">
          {isNew && !pending && (
            <div className="flex flex-col items-center gap-4 py-8 text-center sm:py-14">
              <span className="ai-rainbow-border flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <HugeiconsIcon icon={BubbleChatSparkIcon} size={24} aria-hidden />
              </span>
              <div>
                <h2 className="text-[18px] font-bold tracking-[-0.02em]">옴니스에게 물어보세요</h2>
                <p className="mt-1 break-keep text-[12.5px] text-muted-foreground">
                  업무 · 지식 카드 · 주간보고 · 채팅 · 지식재산권 · 회사 기록을 찾아 답합니다. 이어서 물으면 앞의 대화를 기억합니다.
                </p>
              </div>
              <div className="grid w-full max-w-[520px] gap-2 sm:grid-cols-2">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => void send(ex)}
                    className="touch-target rounded-lg border bg-card px-3 py-2.5 text-left text-[12.5px] transition-colors hover:border-border-strong hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div role="log" aria-label="옴니스와의 대화" className="flex flex-col">
            {rows.map((row) => {
              if (row.type === "day") return <DayDivider key={row.key} label={row.label} />
              const m = row.message
              const fresh = new Date(m.createdAt).getTime() > mountedAt
              return m.fromOmnis ? (
                <OmnisMessage key={row.key} message={m} fresh={fresh} />
              ) : (
                <MyMessage key={row.key} content={m.content} iso={m.createdAt} fresh={fresh} />
              )
            })}
            {pending && <MyMessage content={pending} sending />}
            {(pending || retrying) && <Thinking />}
            {unanswered && roomId && (
              <div className="mt-2 flex flex-wrap items-center justify-end gap-2 text-[12px] text-muted-foreground" role="status">
                <span>{error ?? "이 질문에 아직 답을 받지 못했어요"}</span>
                <Button size="sm" variant="outline" className="touch-target gap-1" onClick={() => void retry(unanswered.id)}>
                  <HugeiconsIcon icon={Refresh01Icon} size={14} aria-hidden />
                  다시 묻기
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      <Composer
        textareaRef={textareaRef}
        value={draft}
        onChange={setDraft}
        onSend={() => void send(draft)}
        busy={busy}
        autoFocus={isNew}
      />
    </div>
  )
}

function MyMessage({ content, iso, sending = false, fresh = false }: { content: string; iso?: string; sending?: boolean; fresh?: boolean }) {
  return (
    <div className={cn("mt-3 flex flex-col items-end gap-0.5", fresh && MESSAGE_ENTER)}>
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap break-keep rounded-2xl rounded-br-md bg-primary/10 px-3.5 py-2 text-[13.5px] leading-[1.6] [overflow-wrap:anywhere]",
          sending && "opacity-60",
        )}
      >
        {tidyBody(content)}
      </div>
      {sending ? (
        <span className="text-[10.5px] text-muted-foreground">보내는 중…</span>
      ) : iso ? (
        <MessageTime iso={iso} className="text-[10.5px]" />
      ) : null}
    </div>
  )
}

function OmnisAvatar() {
  return (
    <span aria-hidden className="ai-rainbow-border mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
      <HugeiconsIcon icon={BubbleChatSparkIcon} size={15} />
    </span>
  )
}

function OmnisMessage({ message, fresh }: { message: OmnisRoomMessage; fresh: boolean }) {
  return (
    <div className={cn("mt-4 flex gap-2.5", fresh && MESSAGE_ENTER)}>
      <OmnisAvatar />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-baseline gap-1.5">
          <span className="text-[13px] font-semibold">옴니스</span>
          <MessageTime iso={message.createdAt} />
        </div>
        <div className="min-w-0 rounded-xl border bg-card px-3.5 py-3">
          <OmnisAnswerBody answer={message.content} sources={message.sources} />
        </div>
      </div>
    </div>
  )
}

function Thinking() {
  return (
    <div className="mt-4 flex gap-2.5" role="status" aria-live="polite">
      <OmnisAvatar />
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <Spinner />
          옴니스가 사내 자료에서 답을 찾는 중…
        </div>
        <div className="flex flex-col gap-2 rounded-xl border bg-card p-3.5">
          <Skeleton className="h-3 w-[85%]" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-[60%]" />
        </div>
      </div>
    </div>
  )
}

function Composer({
  textareaRef,
  value,
  onChange,
  onSend,
  busy,
  autoFocus,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  value: string
  onChange: (v: string) => void
  onSend: () => void
  busy: boolean
  autoFocus: boolean
}) {
  // 내용만큼 늘린다 — 6줄을 넘으면 안에서 민다
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [value, textareaRef])

  const tooLong = value.length > OMNIS_MESSAGE_MAX
  const canSend = !busy && value.trim().length >= 2 && !tooLong

  return (
    <div className="shrink-0 border-t bg-background px-3 pb-3 pt-2 sm:px-6">
      <div className="mx-auto w-full max-w-[760px]">
        <div className="flex items-end gap-2 rounded-2xl border bg-card px-3 py-2 shadow-[0_2px_8px_rgba(0,0,0,0.04)] focus-within:border-border-strong">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                if (canSend) onSend()
              }
            }}
            rows={1}
            autoFocus={autoFocus}
            aria-label="옴니스에게 보낼 글"
            placeholder={busy ? "옴니스가 답하는 중…" : "옴니스에게 물어보세요"}
            className="max-h-40 min-h-[1.6em] flex-1 resize-none bg-transparent py-1 text-[14px] leading-[1.6] outline-none placeholder:text-muted-foreground"
          />
          <Button
            size="icon"
            onClick={onSend}
            disabled={!canSend}
            aria-label="보내기"
            title="보내기 (Enter)"
            className="touch-target ai-rainbow-border shrink-0 rounded-full"
          >
            {busy ? <Spinner /> : <HugeiconsIcon icon={ArrowUp01Icon} size={16} aria-hidden />}
          </Button>
        </div>
        <div className="mt-1 flex justify-between gap-2 px-1 text-[10.5px] text-muted-foreground">
          <span className="hidden sm:inline">Enter 보내기 · Shift+Enter 줄바꿈 · 읽기만 합니다 — 업무를 만들거나 고치지 않아요</span>
          <span className={cn("ml-auto tabular-nums", tooLong && "font-medium text-destructive")}>
            {value.length > OMNIS_MESSAGE_MAX * 0.8 ? `${value.length}/${OMNIS_MESSAGE_MAX}` : ""}
          </span>
        </div>
      </div>
    </div>
  )
}
