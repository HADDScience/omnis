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
import type { AgentCard as AgentCardData, AgentRoomState } from "@/lib/agent/service"
import type { ToolUse } from "@/lib/agent/tool-trail"
import { answeredAfter, showPendingBubble, unansweredQuestion } from "@/lib/agent/room-view"
import { EMPTY_LIVE, foldChunk, liveText, readAgentStream, TOOL_LABEL, type LiveAnswer, type LiveTool } from "@/lib/agent/client-stream"
import { AgentCard } from "./agent-card"
import { ToolTrail } from "./tool-trail"
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
  initialTools = {},
  activeRun = null,
}: {
  roomId: string | null
  roomName?: string
  initialMessages: OmnisRoomMessage[]
  initialCards?: AgentCardData[]
  initialTools?: Record<string, ToolUse[]>
  activeRun?: { id: string; status: string } | null
}) {
  const reloadList = useRoomListReload()
  const [roomId, setRoomId] = useState(initialRoomId)
  const [messages, setMessages] = useState(initialMessages)
  const [cards, setCards] = useState(initialCards)
  const [tools, setTools] = useState(initialTools)
  const [draft, setDraft] = useState("")
  /** 보내는 중인 글 — 방 글에 그 질문(questionId)이 들어올 때까지 옅게 보인다 */
  const [pending, setPending] = useState<{ content: string; questionId: string | null } | null>(null)
  /** 스트림으로 받는 중인 답. null 이면 읽고 있지 않다 */
  const [live, setLive] = useState<LiveAnswer | null>(null)
  /**
   * 서버에서 돌고 있는 실행(id). 스트림을 읽지 않아도 서버는 답을 쓰는 중일 수 있다 — 새로고침 · 앱 전환 · 연결 끊김.
   * 이 값이 있으면 「답을 못 받았다」 고 하지 않고 그 실행의 스트림에 다시 붙는다(lib/agent/room-view.ts)
   */
  const [running, setRunning] = useState<string | null>(activeRun?.status === "RUNNING" ? activeRun.id : null)
  const [deciding, setDeciding] = useState<{ id: string; decision: "approve" | "reject" } | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 하루 상한(429) 안내 — 데모 사이트. 입력창 위에 남겨 둔다(토스트만으로는 왜 안 되는지 금방 사라진다) */
  const [quotaNotice, setQuotaNotice] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [mountedAt] = useState(() => Date.now())
  /** 지금 읽고 있는 스트림 수 — 다시 붙기가 겹치지 않게 */
  const streams = useRef(0)
  /** 보내기 잠금 — 상태(pending)는 다음 그리기에야 보여 같은 순간 두 번 누르면 둘 다 지나갔다 */
  const sendingRef = useRef(false)
  const busy = pending !== null || live !== null || deciding !== null || running !== null

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, cards.length, pending, live, error])

  /** 방 상태를 DB 에서 다시 — 스트림이 끝날 때마다. 돌고 있는 실행도 함께 안다 */
  const refresh = useCallback(async (id: string) => {
    const res = await fetch(apiUrl(`/api/agent/rooms/${id}`), { cache: "no-store" }).catch(() => null)
    if (!res?.ok) return null
    const state = (await res.json()) as AgentRoomState
    setMessages(state.messages)
    setCards(state.cards)
    setTools(state.tools ?? {})
    setRunning(state.activeRun?.status === "RUNNING" ? state.activeRun.id : null)
    return state
  }, [])

  /** 스트림 응답을 끝까지 읽는다. 실패(JSON)면 메시지를 던진다 */
  const consume = useCallback(async (res: Response, onHeaders?: (h: Headers) => void) => {
    if (!res.ok || !res.headers.get("content-type")?.includes("text/event-stream")) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      throw Object.assign(new Error(data?.error ?? `답을 받지 못했습니다 (${res.status})`), { status: res.status })
    }
    onHeaders?.(res.headers)
    streams.current++
    try {
      setLive(EMPTY_LIVE)
      let last = EMPTY_LIVE
      await readAgentStream(res, (c) => {
        last = foldChunk(last, c)
        setLive(last)
      })
      if (last.error) throw new Error(last.error)
    } finally {
      streams.current--
    }
  }, [])

  /**
   * 돌고 있는 실행에 다시 붙는다(처음부터 다시 받는다). 끝나면 방을 다시 읽고, 그래도 돌고 있으면(구간이 이어졌거나
   * 스트림만 끊겼으면) 조금 쉬었다 또 붙는다. 다시 붙기가 겹치지 않게 하나만 돈다
   */
  const following = useRef(false)
  const follow = useCallback(
    async (id: string, runId: string) => {
      if (following.current) return
      following.current = true
      try {
        for (let attempt = 0; attempt < 6; attempt++) {
          try {
            await consume(await fetch(apiUrl(`/api/agent/runs/${runId}/stream`), { cache: "no-store" }))
          } catch {
            // 이미 끝났으면 409 · 연결이 끊겼으면 네트워크 오류 — 어느 쪽이든 방 상태가 답이다
          }
          setLive(null)
          const state = await refresh(id)
          if (!state) return // 연결이 없다 — 돌아오면(online · visibilitychange) 다시 붙는다
          if (state.activeRun?.status !== "RUNNING") return
          runId = state.activeRun.id
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
        }
        // 여섯 번을 붙어도 끝나지 않으면 기다림을 푼다 — 서버는 5분 넘게 갱신 없는 실행을 죽은 것으로 본다
        setRunning(null)
      } finally {
        following.current = false
        setLive(null)
      }
    },
    [consume, refresh],
  )

  // 새로고침 · 재접속 — 돌고 있는 실행이 있으면 그 스트림에 다시 붙는다
  const reattached = useRef(false)
  useEffect(() => {
    if (reattached.current || !initialRoomId || activeRun?.status !== "RUNNING") return
    reattached.current = true
    void follow(initialRoomId, activeRun.id)
  }, [initialRoomId, activeRun, follow])

  // 폰에서 앱을 바꿨다 돌아오거나 망이 돌아오면 — 그사이 끊긴 스트림 대신 방을 다시 읽고, 돌고 있으면 붙는다
  useEffect(() => {
    if (!roomId) return
    const wake = () => {
      if (document.visibilityState !== "visible" || streams.current > 0 || following.current) return
      void refresh(roomId).then((s) => {
        if (s?.activeRun?.status === "RUNNING") void follow(roomId, s.activeRun.id)
      })
    }
    document.addEventListener("visibilitychange", wake)
    window.addEventListener("online", wake)
    return () => {
      document.removeEventListener("visibilitychange", wake)
      window.removeEventListener("online", wake)
    }
  }, [roomId, refresh, follow])

  // 답을 못 받은 내 글 — 마지막이 내 질문이고, 읽는 스트림도 · 서버에 도는 실행도 · 기다리는 카드도 없을 때(새로고침해도 남는다)
  const unanswered = unansweredQuestion({ messages, cards, busy, running: running !== null })
  const waitingCard = cards.some((c) => c.status === "PENDING")

  /** 스트림이 끝난 뒤 — 방을 다시 읽고, 서버가 아직 돌고 있으면(스트림만 먼저 끝났으면) 다시 붙는다 */
  async function settle(id: string) {
    const state = await refresh(id)
    if (state?.activeRun?.status === "RUNNING") void follow(id, state.activeRun.id)
    return state
  }

  async function ask(body: { content: string } | { retryOf: string }, shown: string) {
    // 보내는 중에는 다시 보내지 않는다 — 버튼 · Enter · 예시 칸이 모두 여기로 온다
    if (busy || sendingRef.current) return
    sendingRef.current = true
    let questionId: string | null = "retryOf" in body ? body.retryOf : null
    setPending({ content: shown, questionId })
    setError(null)
    let id = roomId
    try {
      const res = id
        ? await fetch(apiUrl(`/api/agent/rooms/${id}`), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        : await fetch(apiUrl("/api/agent/rooms"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      await consume(res, (h) => {
        const created = h.get("x-room-id")
        const qid = h.get("x-question-id")
        if (qid) {
          questionId = qid
          setPending({ content: shown, questionId: qid })
        }
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
      const status = (err as { status?: number }).status
      const state = id ? await refresh(id) : null
      setLive(null)
      setPending(null)
      sendingRef.current = false
      // 서버가 거절한 것(status)이 아니면 스트림만 끊겼을 수 있다 — 답이 남았거나 아직 돌고 있으면 오류가 아니다
      if (!status && state && (answeredAfter(state.messages, questionId) || state.activeRun?.status === "RUNNING")) {
        if (state.activeRun?.status === "RUNNING") void follow(id!, state.activeRun.id)
        return
      }
      setError(message)
      if (status === 429) setQuotaNotice(message)
      else toast.error(message)
      // 질문 글이 남지 못했으면 입력창에 되돌린다
      const saved = questionId ? state?.messages.some((m) => m.id === questionId) : false
      if ("content" in body && !saved) setDraft(body.content)
      return
    }
    if (id) await settle(id)
    setLive(null)
    setPending(null)
    sendingRef.current = false
    textareaRef.current?.focus()
  }

  function send(raw: string) {
    const content = raw.trim()
    if (content.length < 2) {
      toast.error("2자 이상 입력해 주세요")
      return
    }
    if (busy || sendingRef.current) return
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
        if (!res.ok || !data?.card) throw Object.assign(new Error(data?.error ?? `처리하지 못했습니다 (${res.status})`), { status: res.status })
        setCards((prev) => prev.map((c) => (c.id === card.id ? data.card! : c)))
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "처리하지 못했습니다"
      // 스트림만 끊긴 것이면 아래 settle 이 다시 붙는다
      if ((err as { status?: number }).status) {
        setError(message)
        toast.error(message)
      }
    } finally {
      setDeciding(null)
      setLive(null)
      await settle(roomId)
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
  let trailFor: string | null = null
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
              // 도구 기록은 그 질문에 붙은 첫 옴니스 글 위에 — 흐름 순서(도구를 본 뒤 답했다)
              if (item.kind === "row" && item.row.type !== "day") {
                const m = item.row.message
                if (!m.fromOmnis) trailFor = m.id
              }
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
              let trail: ToolUse[] = []
              if (m.fromOmnis && trailFor) {
                trail = tools[trailFor] ?? []
                trailFor = null
              }
              return m.fromOmnis ? (
                <OmnisMessage key={row.key} message={m} fresh={fresh} tools={trail} />
              ) : (
                <MyMessage key={row.key} content={m.content} iso={m.createdAt} fresh={fresh} />
              )
            })}
            {pending && showPendingBubble(messages, pending) && <MyMessage content={pending.content} sending />}
            {(live || pending || running) && <LiveOmnis text={text} tools={live?.tools ?? []} resuming={!live && !pending} />}
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

      {quotaNotice && (
        <p role="status" data-agent-quota className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-1 text-center text-[12.5px] text-amber-700 dark:text-amber-300">
          {quotaNotice}
        </p>
      )}
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
function LiveOmnis({ text, tools, resuming = false }: { text: string; tools: LiveTool[]; resuming?: boolean }) {
  const running = tools.filter((t) => t.state === "running").at(-1)
  const status = resuming
    ? "옴니스가 답하는 중… 이어 받는 중"
    : running
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
        <ToolTrail items={tools} live />
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

function OmnisMessage({ message, fresh, tools }: { message: OmnisRoomMessage; fresh: boolean; tools: ToolUse[] }) {
  return (
    <div className={cn("mt-4 flex gap-2.5", fresh && MESSAGE_ENTER)}>
      <OmnisAvatar />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-baseline gap-1.5">
          <span className="text-[13px] font-semibold">옴니스</span>
          <MessageTime iso={message.createdAt} />
        </div>
        <ToolTrail items={tools} />
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
