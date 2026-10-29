"use client"

import { useCallback, useEffect, useRef, useState } from "react"
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
import type { AgentCard as AgentCardData } from "@/lib/agent/service"
import { EMPTY_LIVE, foldChunk, liveText, readAgentStream, TOOL_LABEL, type LiveAnswer, type LiveTool } from "@/lib/agent/client-stream"
import { AgentCard } from "./agent-card"
import { RoomHeader } from "./room-header"
import { useRoomListReload } from "./messenger-shell"

const EXAMPLES = [
  "이번 주 마감인 업무 정리해 줘",
  "멈춰 있는 업무와 담당자 알려줘",
  "보유한 특허와 상표 현황은?",
  "올해 정부과제 목록 보여 줘",
]

/**
 * 옴니스 1:1 방. roomId 가 null 이면 「새 대화」 — 첫 글을 보내는 순간 방이 생기고 주소만 그 방으로 바꾼다(화면은 그대로).
 *
 * 답은 에이전트(lib/agent/, WorkflowAgent)가 스트림으로 보낸다. 읽기 도구는 바로 돌고, 쓰기는 확인 카드를 띄우고 멈춘다.
 * 카드의 [확인] 을 누르면 같은 실행이 이어지며 다시 스트림이 온다. 방의 글 · 카드는 DB 가 원본이라
 * 스트림이 끝날 때마다 방 상태를 다시 읽는다 — 새로고침해도 카드가 그대로 남는다.
 */
export function OmnisRoom({
  roomId: initialRoomId,
  roomName,
  initialMessages,
  initialCards = [],
  activeRun = null,
}: {
  roomId: string | null
  roomName?: string
  initialMessages: OmnisRoomMessage[]
  initialCards?: AgentCardData[]
  activeRun?: { id: string; status: string } | null
}) {
  const reloadList = useRoomListReload()
  const [roomId, setRoomId] = useState(initialRoomId)
  const [messages, setMessages] = useState(initialMessages)
  const [cards, setCards] = useState(initialCards)
  const [draft, setDraft] = useState("")
  /** 보내는 중인 글 — 방 상태를 다시 읽을 때까지 옅게 보인다 */
  const [pending, setPending] = useState<string | null>(null)
  /** 스트림으로 받는 중인 답. null 이면 돌고 있지 않다 */
  const [live, setLive] = useState<LiveAnswer | null>(null)
  const [deciding, setDeciding] = useState<{ id: string; decision: "approve" | "reject" } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [mountedAt] = useState(() => Date.now())
  const busy = pending !== null || live !== null || deciding !== null

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, cards.length, pending, live, error])

  /** 방 상태를 DB 에서 다시 — 스트림이 끝날 때마다 */
  const refresh = useCallback(async (id: string) => {
    const res = await fetch(apiUrl(`/api/agent/rooms/${id}`), { cache: "no-store" })
    if (!res.ok) return null
    const state = (await res.json()) as { messages: OmnisRoomMessage[]; cards: AgentCardData[]; activeRun: { id: string; status: string } | null }
    setMessages(state.messages)
    setCards(state.cards)
    return state
  }, [])

  /** 스트림 응답을 끝까지 읽는다. 실패(JSON)면 메시지를 던진다 */
  const consume = useCallback(async (res: Response, onHeaders?: (h: Headers) => void) => {
    if (!res.ok || !res.headers.get("content-type")?.includes("text/event-stream")) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      throw new Error(data?.error ?? `답을 받지 못했습니다 (${res.status})`)
    }
    onHeaders?.(res.headers)
    setLive(EMPTY_LIVE)
    let last = EMPTY_LIVE
    await readAgentStream(res, (c) => {
      last = foldChunk(last, c)
      setLive(last)
    })
    if (last.error) throw new Error(last.error)
  }, [])

  // 새로고침 · 재접속 — 돌고 있는 실행이 있으면 그 스트림에 다시 붙는다
  const reattached = useRef(false)
  useEffect(() => {
    if (reattached.current || !initialRoomId || activeRun?.status !== "RUNNING") return
    reattached.current = true
    void (async () => {
      try {
        await consume(await fetch(apiUrl(`/api/agent/runs/${activeRun.id}/stream`), { cache: "no-store" }))
      } catch {
        // 이미 끝났으면 409 — 상태만 다시 읽는다
      } finally {
        setLive(null)
        await refresh(initialRoomId)
      }
    })()
  }, [initialRoomId, activeRun, consume, refresh])

  // 답을 못 받은 내 글 — 마지막이 내 질문이고 기다리는 카드도 없으면 「다시 묻기」(새로고침해도 남는다)
  const last = messages.at(-1)
  const waitingCard = cards.some((c) => c.status === "PENDING")
  const unanswered = last && !last.fromOmnis && !busy && !waitingCard && !cards.some((c) => c.createdAt > last.createdAt) ? last : null

  async function ask(body: { content: string } | { retryOf: string }, shown: string) {
    if (busy) return
    setPending(shown)
    setError(null)
    let id = roomId
    try {
      const res = id
        ? await fetch(apiUrl(`/api/agent/rooms/${id}`), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        : await fetch(apiUrl("/api/agent/rooms"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      await consume(res, (h) => {
        const created = h.get("x-room-id")
        if (created && !id) {
          id = created
          setRoomId(created)
          // 화면을 다시 그리지 않고 주소만 — 스트림이 끊기지 않게
          window.history.replaceState(null, "", apiUrl(`/chat/${created}`))
          reloadList()
        }
      })
      reloadList()
    } catch (err) {
      const message = err instanceof Error ? err.message : "보내지 못했습니다"
      // 질문 글이 남지 못했으면 입력창에 되돌린다(아래 refresh 가 남았는지 알려 준다)
      setError(message)
      toast.error(message)
      if (id) {
        const state = await refresh(id)
        if ("content" in body && !state?.messages.some((m) => !m.fromOmnis && m.content === body.content)) setDraft(body.content)
      } else if ("content" in body) setDraft(body.content)
      id = id ?? null
      setLive(null)
      setPending(null)
      return
    }
    if (id) await refresh(id)
    setLive(null)
    setPending(null)
    textareaRef.current?.focus()
  }

  function send(raw: string) {
    const content = raw.trim()
    if (content.length < 2) {
      toast.error("2자 이상 입력해 주세요")
      return
    }
    setDraft("")
    void ask({ content }, content)
  }

  async function decide(card: AgentCardData, decision: "approve" | "reject") {
    if (busy || !roomId) return
    setDeciding({ id: card.id, decision })
    setError(null)
    try {
      const res = await fetch(apiUrl(`/api/agent/steps/${card.id}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, planHash: card.planHash }),
      })
      if (res.headers.get("content-type")?.includes("text/event-stream")) {
        setCards((prev) => prev.map((c) => (c.id === card.id ? { ...c, status: decision === "approve" ? "APPROVED" : "REJECTED" } : c)))
        setDeciding(null)
        await consume(res)
      } else {
        const data = (await res.json().catch(() => null)) as { card?: AgentCardData; error?: string } | null
        if (!res.ok || !data?.card) throw new Error(data?.error ?? `처리하지 못했습니다 (${res.status})`)
        setCards((prev) => prev.map((c) => (c.id === card.id ? data.card! : c)))
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "처리하지 못했습니다"
      setError(message)
      toast.error(message)
    } finally {
      setDeciding(null)
      setLive(null)
      await refresh(roomId)
      reloadList()
    }
  }

  // 글과 카드를 시간 순으로 한 줄에
  const rows = layoutMessages(messages.map((m) => ({ ...m, author: { id: m.fromOmnis ? "omnis" : "me", name: "" } })))
  const timeline: ({ kind: "row"; row: (typeof rows)[number]; at: string } | { kind: "card"; card: AgentCardData; at: string })[] = []
  {
    let ci = 0
    const sortedCards = [...cards].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    for (const row of rows) {
      const at = row.type === "day" ? null : row.message.createdAt
      while (at && ci < sortedCards.length && sortedCards[ci].createdAt < at) {
        timeline.push({ kind: "card", card: sortedCards[ci], at: sortedCards[ci].createdAt })
        ci++
      }
      timeline.push({ kind: "row", row, at: at ?? "" })
    }
    for (; ci < sortedCards.length; ci++) timeline.push({ kind: "card", card: sortedCards[ci], at: sortedCards[ci].createdAt })
  }
  const isNew = roomId === null && messages.length === 0
  const text = live ? liveText(live) : ""

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RoomHeader
        title={isNew ? "새 대화" : (roomName ?? (messages[0] ? messages[0].content.replace(/\s+/g, " ").slice(0, 30) : "옴니스"))}
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
                  업무 · 지식 카드 · 주간보고 · 채팅 · 지식재산권 · 회사 기록을 찾아 답합니다. 업무를 만들거나 고치는 일은 확인 카드를 띄우고, 확인하면 실행합니다.
                </p>
              </div>
              <div className="grid w-full max-w-[520px] gap-2 sm:grid-cols-2">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => send(ex)}
                    className="touch-target rounded-lg border bg-card px-3 py-2.5 text-left text-[12.5px] transition-colors hover:border-border-strong hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div role="log" aria-label="옴니스와의 대화" className="flex flex-col">
            {timeline.map((item) => {
              if (item.kind === "card") {
                const c = item.card
                return (
                  <AgentCard
                    key={`card-${c.id}`}
                    card={c}
                    deciding={deciding?.id === c.id ? deciding.decision : null}
                    disabled={busy}
                    onDecide={(d) => void decide(c, d)}
                  />
                )
              }
              const row = item.row
              if (row.type === "day") return <DayDivider key={row.key} label={row.label} />
              const m = row.message
              const fresh = new Date(m.createdAt).getTime() > mountedAt
              return m.fromOmnis ? (
                <OmnisMessage key={row.key} message={m} fresh={fresh} />
              ) : (
                <MyMessage key={row.key} content={m.content} iso={m.createdAt} fresh={fresh} />
              )
            })}
            {pending && !messages.some((m) => !m.fromOmnis && m.content === pending && new Date(m.createdAt).getTime() > mountedAt) && (
              <MyMessage content={pending} sending />
            )}
            {(live || (pending && !live)) && <LiveOmnis text={text} tools={live?.tools ?? []} />}
            {unanswered && roomId && (
              <div className="mt-2 flex flex-wrap items-center justify-end gap-2 text-[12px] text-muted-foreground" role="status">
                <span>{error ?? "이 질문에 아직 답을 받지 못했어요"}</span>
                <Button size="sm" variant="outline" className="touch-target gap-1" onClick={() => void ask({ retryOf: unanswered.id }, unanswered.content)}>
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
        onSend={() => send(draft)}
        busy={busy}
        autoFocus={isNew}
        waitingCard={waitingCard}
      />
    </div>
  )
}

/** 스트림으로 받는 중인 답 — 도는 도구 한 줄 + 지금까지 쓴 글. 글이 오기 전에는 스켈레톤 */
function LiveOmnis({ text, tools }: { text: string; tools: LiveTool[] }) {
  const running = tools.filter((t) => t.state === "running").at(-1)
  const status = running
    ? `${TOOL_LABEL[running.name] ?? running.name} 보는 중…`
    : tools.some((t) => t.state === "approval")
      ? "확인 카드를 만드는 중…"
      : text
        ? "쓰는 중…"
        : "옴니스가 생각하는 중…"
  return (
    <div className="mt-4 flex gap-2.5" role="status" aria-live="polite" data-agent-live>
      <OmnisAvatar />
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <Spinner />
          {status}
        </div>
        {tools.length > 0 && (
          <ul className="mb-1.5 flex flex-wrap gap-1" aria-label="옴니스가 본 자료">
            {tools.map((t) => (
              <li key={t.id} className="rounded-full border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
                {TOOL_LABEL[t.name] ?? t.name}
                {t.state === "done" ? " ✓" : t.state === "approval" ? " · 확인 필요" : " …"}
              </li>
            ))}
          </ul>
        )}
        <div className="min-w-0 rounded-xl border bg-card px-3.5 py-3">
          {text ? (
            <OmnisAnswerBody answer={text} sources={[]} />
          ) : (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3 w-[85%]" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-[60%]" />
            </div>
          )}
        </div>
      </div>
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

function Composer({
  textareaRef,
  value,
  onChange,
  onSend,
  busy,
  autoFocus,
  waitingCard,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  value: string
  onChange: (v: string) => void
  onSend: () => void
  busy: boolean
  autoFocus: boolean
  waitingCard: boolean
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
          <span className="hidden sm:inline">
            {waitingCard ? "위 확인 카드를 눌러 주세요 · 새 글을 보내면 그 제안은 버려집니다" : "Enter 보내기 · Shift+Enter 줄바꿈 · 쓰기는 확인 카드를 거칩니다"}
          </span>
          <span className={cn("ml-auto tabular-nums", tooLong && "font-medium text-destructive")}>
            {value.length > OMNIS_MESSAGE_MAX * 0.8 ? `${value.length}/${OMNIS_MESSAGE_MAX}` : ""}
          </span>
        </div>
      </div>
    </div>
  )
}
