"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "@/components/ui/spinner"
import { format } from "date-fns"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowTurnBackwardIcon,
  Delete02Icon,
  Doc01Icon,
  File01Icon,
  Pdf01Icon,
  PencilEdit01Icon,
  Ppt01Icon,
  Task01Icon,
  Xls01Icon,
  ZipIcon,
} from "@hugeicons/core-free-icons"
import { TASK_STATUS_LABELS, TASK_STATUS_COLORS, PRIORITY_LABELS } from "@/lib/constants"
import { layoutMessages, tidyBody } from "@/lib/chat-layout"
import { arrivals, followOnAppend, unseenLabel } from "@/lib/chat-follow"
import { isStuckToBottom } from "@/lib/agent/scroll-follow"
import { AuthorAvatar, DayDivider, MessageTime } from "@/components/chat/message-parts"

import { apiUrl } from "@/lib/base-path"
export interface FileInfo {
  id: string
  name: string
  path: string
  size: number
  mimeType: string
  _uploading?: boolean
}

interface Message {
  id: string
  content: string
  createdAt: string
  isTaskInstruction: boolean
  _isSystem?: boolean
  /** 보내는 중 말풍선을 서버 응답으로 바꾼 것 — 이미 한 번 떠올랐으니 다시 움직이지 않는다 */
  _settled?: boolean
  /** 보내지 못한 글 — 까닭. 「다시 보내기 · 지우기」 를 띄운다 */
  _failed?: string
  author: { id: string; name: string }
  task?: {
    id: string
    name: string
    slug: string
    status?: string
    priority?: string
    deadline?: string | null
    owner?: { id: string; name: string } | null
    _count?: { checklists: number }
  } | null
  files?: FileInfo[]
  /** 고친 글은 시간 옆에 「수정됨」 을 단다 */
  editedAt?: string | null
  /** 지운 글은 자리만 남는다 — 본문은 서버가 내려보내지 않는다 */
  deletedAt?: string | null
  replyTo?: { id: string; authorName: string; content: string } | null
}

/** 말풍선 안에서 검색어가 걸린 자리들. 링크 · 칩 경계를 넘는 일치는 잡지 않는다 */
function findTextRanges(body: HTMLElement, query: string): Range[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const ranges: Range[] = []
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const lower = (node.textContent ?? "").toLowerCase()
    for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + needle.length)) {
      const range = new Range()
      range.setStart(node, at)
      range.setEnd(node, at + needle.length)
      ranges.push(range)
    }
  }
  return ranges
}

/** 새 메시지가 아래에서 살짝 떠오른다. 움직임 줄이기 설정이면 멈춘다 */
export const MESSAGE_ENTER = "animate-in fade-in-0 slide-in-from-bottom-2 duration-300 ease-out motion-reduce:animate-none"

interface TaskRef {
  id: string
  name: string
  slug: string
}

interface MessageListProps {
  messages: Message[]
  currentUserId: string
  selectionMode?: boolean
  selectedIds?: Set<string>
  onToggleSelect?: (id: string) => void
  tasks?: TaskRef[]
  processingSlug?: string | null
  /** 위로 스크롤 시 이전 메시지 로드 요청 */
  onLoadOlder?: () => void
  /** 더 불러올 이전 메시지가 있는지 */
  hasMoreOlder?: boolean
  /** 이전 메시지 로딩 중 */
  loadingOlder?: boolean
  /** 답장 — 입력창이 대상 글을 물고 있게 한다 */
  onReply?: (message: { id: string; authorName: string; content: string }) => void
  /** 내 글 고치기. 저장이 끝나면 목록을 다시 읽는 것은 부모가 한다 */
  onEdit?: (id: string, content: string) => Promise<void>
  onDelete?: (id: string) => Promise<void>
  /** 보내지 못한 글 다시 보내기 · 거두기 (보내는 중 말풍선 id) */
  onResend?: (tempId: string) => void
  onDiscardFailed?: (tempId: string) => void
  /** 검색 결과로 갈 때 — 이 글을 가운데로 가져와 잠깐 강조한다. n 은 같은 글을 다시 눌렀을 때 다시 움직이게 */
  highlight?: { id: string; n: number } | null
  /** 검색 결과 보기 중 — 최신이 아닌 자리를 보고 있다. 뒤를 붙여도 맨 아래로 끌어내리지 않는다 */
  jumped?: boolean
  /** 아래로 스크롤 시 뒤 메시지 로드 요청 (검색 결과 보기 중에만) */
  onLoadNewer?: () => void
  hasMoreNewer?: boolean
  loadingNewer?: boolean
  /** 검색어 — 말풍선 안 걸린 글자에 표시한다(CSS Custom Highlight). 지금 결과(highlight)는 더 진하게 */
  searchText?: string
}

export function MessageList({
  messages,
  currentUserId,
  selectionMode = false,
  selectedIds,
  onToggleSelect,
  tasks = [],
  processingSlug,
  onLoadOlder,
  hasMoreOlder = false,
  loadingOlder = false,
  onReply,
  onEdit,
  onDelete,
  onResend,
  onDiscardFailed,
  highlight = null,
  jumped = false,
  onLoadNewer,
  hasMoreNewer = false,
  loadingNewer = false,
  searchText = "",
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  // 고치는 중인 글은 한 번에 하나다 — 여러 줄을 동시에 열면 무엇을 저장하는지 흐려진다
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)
  // 이 시각 뒤에 생긴 메시지만 떠오르게 한다 — 처음 불러온 목록 · 이전 메시지는 가만히 둔다
  const [mountedAt] = useState(() => Date.now())
  const prevFirstIdRef = useRef<string | null>(null)
  // 직전에 그린 글 id — 새로 붙은 글을 가린다(lib/chat-follow.ts)
  const prevIdsRef = useRef<Set<string> | null>(null)
  // 맨 아래에 붙어 있는가. 스크롤할 때마다 갱신한다 — 새 글이 붙은 뒤에는 높이가 바뀌어 다시 잴 수 없다
  const stuckRef = useRef(true)
  // 따라 내려가는 부드러운 스크롤 중 — 그사이 scroll 이벤트는 아직 바닥이 아니어도 붙어 있는 것으로 본다
  const followingRef = useRef(false)
  // 위로 올려 읽는 동안 붙은 남의 글 수 — 「새 메시지 N개 ↓」
  const [unseen, setUnseen] = useState(0)
  const anchorRef = useRef<{ height: number; top: number } | null>(null)
  // 아래 레이아웃 효과는 messages 가 바뀔 때만 돈다 — jumped · highlight 는 ref 로 읽어 deps 에 넣지 않는다
  const jumpedRef = useRef(jumped)
  const highlightRef = useRef(highlight)
  // 아래 효과보다 먼저 선언해 같은 커밋에서 먼저 돈다
  useLayoutEffect(() => {
    jumpedRef.current = jumped
    highlightRef.current = highlight
  })
  const scrolledHighlightRef = useRef<number | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)

  // 이전 메시지(prepend)면 스크롤 위치 유지, 그 외(새 메시지·초기 로드)는 맨 아래로
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) {
      // 빈 목록 화면이라 스크롤 칸이 없다. 다음에 그려질 칸은 새 칸(scrollTop 0)이다 — 처음 그리는 것으로 되돌린다.
      // 이게 없으면 방을 열 때(ChatPanel 이 목록을 비웠다 다시 채운다) 같은 글이 「새 글 없음」 으로 보여 맨 위에 머문다
      prevFirstIdRef.current = null
      prevIdsRef.current = null
      stuckRef.current = true
      return
    }
    const firstId = messages[0]?.id ?? null
    const prevFirstId = prevFirstIdRef.current
    const isPrepend =
      prevFirstId != null &&
      firstId !== prevFirstId &&
      messages.some((m) => m.id === prevFirstId)

    if (isPrepend && anchorRef.current) {
      // prepend된 높이만큼 스크롤을 내려 시야를 그대로 유지
      el.scrollTop =
        el.scrollHeight - anchorRef.current.height + anchorRef.current.top
      anchorRef.current = null
    } else if (jumpedRef.current || (highlightRef.current && highlightRef.current.n !== scrolledHighlightRef.current)) {
      // 검색 결과 보기 — 자리는 아래 강조 효과가 잡는다. 뒤를 붙일 때도 보던 자리에 둔다
    } else if (prevFirstId != null) {
      const added = arrivals(prevIdsRef.current, messages)
      if (added === null) {
        // 목록을 갈아 끼웠다(최신으로 · 업무 필터) — 맨 아래부터
        el.scrollTop = el.scrollHeight
        stuckRef.current = true
        setUnseen(0)
      } else {
        // 새 글 — 맨 아래에 있었거나 내가 보낸 글이면 따라 내려간다. 위로 올려 읽는 중이면 자리를 지키고 센다
        const { follow, unseen: more } = followOnAppend(added, stuckRef.current, (m) => m.author.id === currentUserId || m.author.id === "me")
        if (follow) {
          followingRef.current = true
          el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
          setUnseen(0)
        } else if (more > 0) {
          setUnseen((n) => n + more)
        }
      }
    } else {
      el.scrollTop = el.scrollHeight
    }
    prevFirstIdRef.current = firstId
    prevIdsRef.current = new Set(messages.map((m) => m.id))
  }, [messages, currentUserId])

  /** 「새 메시지 N개 ↓」 — 맨 아래로 내려가고 알약을 걷는다 */
  function jumpToLatest() {
    const el = scrollRef.current
    if (!el) return
    followingRef.current = true
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
    setUnseen(0)
  }

  /** 사용자가 직접 굴렸다 — 따라 내려가던 스크롤은 거기서 끝난 것으로 본다 */
  function userScrolled() {
    followingRef.current = false
  }

  // 검색 결과로 온 글을 가운데로 — 위 효과 뒤에 돈다(선언 순서)
  useLayoutEffect(() => {
    if (!highlight || highlight.n === scrolledHighlightRef.current) return
    const target = scrollRef.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(highlight.id)}"]`)
    if (!target) return
    scrolledHighlightRef.current = highlight.n
    // 검색어가 있으면 말풍선이 아니라 걸린 글자를 가운데로 — 긴 글에서 말풍선 가운데는 걸린 자리가 아닐 수 있다.
    // 글자 표시가 되는 브라우저면 말풍선 전체를 번쩍이지 않는다(카톡처럼 글자만 진하게)
    const body = target.querySelector<HTMLElement>("[data-message-body]")
    const first = body ? findTextRanges(body, searchText)[0] : undefined
    const el = scrollRef.current
    if (first && el) {
      const r = first.getBoundingClientRect()
      const box = el.getBoundingClientRect()
      el.scrollTop += r.top - box.top - box.height / 2 + r.height / 2
      if (typeof CSS !== "undefined" && CSS.highlights) return
    } else {
      target.scrollIntoView({ block: "center" })
    }
    setFlashId(highlight.id)
  }, [highlight, messages, searchText])

  // 걸린 글자 표시. DOM 위에 범위만 거는 방식이라 링크 · 칩으로 쪼갠 렌더를 건드리지 않는다.
  // 지원하지 않는 브라우저(Firefox 140 미만)는 표시 없이 지금 결과 말풍선 강조만 남는다
  useEffect(() => {
    const registry = typeof CSS !== "undefined" ? CSS.highlights : undefined
    if (!registry || typeof Highlight === "undefined") return
    const root = scrollRef.current
    const needle = searchText.trim().toLowerCase()
    if (!root || !needle) return
    const hits: Range[] = []
    const current: Range[] = []
    root.querySelectorAll<HTMLElement>("[data-message-body]").forEach((body) => {
      const isCurrent = body.closest("[data-message-id]")?.getAttribute("data-message-id") === highlight?.id
      ;(isCurrent ? current : hits).push(...findTextRanges(body, needle))
    })
    registry.set("chat-search-hit", new Highlight(...hits))
    const now = new Highlight(...current)
    now.priority = 1
    registry.set("chat-search-current", now)
    return () => {
      registry.delete("chat-search-hit")
      registry.delete("chat-search-current")
    }
  }, [messages, searchText, highlight, editingId])

  useEffect(() => {
    if (!flashId) return
    const timer = setTimeout(() => setFlashId(null), 2000)
    return () => clearTimeout(timer)
  }, [flashId, highlight])

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    const atBottom = isStuckToBottom(el)
    if (atBottom) {
      followingRef.current = false
      if (unseen > 0) setUnseen(0)
    }
    stuckRef.current = atBottom || followingRef.current
    if (onLoadNewer && hasMoreNewer && !loadingNewer && el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
      onLoadNewer()
    }
    if (!onLoadOlder) return
    if (el.scrollTop < 80 && hasMoreOlder && !loadingOlder) {
      // prepend 직전 스크롤 상태를 기록 → useLayoutEffect에서 위치 복원
      anchorRef.current = { height: el.scrollHeight, top: el.scrollTop }
      onLoadOlder()
    }
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        아직 메시지가 없습니다. 대화를 시작해보세요.
      </div>
    )
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {unseen > 0 && (
        // 위로 올려 읽는 중에 붙은 글 — 끌어내리지 않고 알린다
        <button
          type="button"
          onClick={jumpToLatest}
          aria-live="polite"
          className="absolute bottom-3 left-1/2 z-10 inline-flex min-h-11 -translate-x-1/2 items-center gap-1 rounded-full bg-primary px-4 text-[12px] font-medium text-primary-foreground shadow-md hover:bg-primary/90 in-data-[messenger]:text-[14px]"
        >
          {unseenLabel(unseen)} ↓
        </button>
      )}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        onWheel={userScrolled}
        onTouchMove={userScrolled}
        onKeyDown={userScrolled}
        className="min-h-0 flex-1 overflow-y-auto px-4 in-data-[messenger]:px-[16px]"
      >
        <div role="log" aria-label="채팅 메시지" className="flex flex-col py-3 in-data-[messenger]:py-4">
          {loadingOlder && (
            <div className="flex justify-center py-1">
              <Spinner className="h-4 w-4" />
            </div>
          )}
          {!hasMoreOlder && !loadingOlder && (
            <div className="py-1 text-center text-[11px] text-muted-foreground in-data-[messenger]:text-[13px]">
              대화의 시작
            </div>
          )}
          {layoutMessages(
            messages.map((m, i) => ({
              ...m,
              isEvent:
                m.content.startsWith("__TASK_CREATED__:") ||
                !!m._isSystem ||
                m.author.id === "system" ||
                m.content.startsWith("🤖"),
              // 같은 업무 태그가 묶음 안 말풍선마다 반복되지 않게 — 다음 메시지가 다른 업무일 때만 붙인다
              nextTaskId: messages[i + 1]?.task?.id ?? null,
            })),
          ).map((row) => {
            if (row.type === "day") return <DayDivider key={row.key} label={row.label} />
            const msg = row.message
            const isMe = msg.author.id === currentUserId || msg.author.id === "me"
            const isSelected = selectedIds?.has(msg.id) ?? false

            // 업무 생성 카드 — content가 `__TASK_CREATED__:<taskId>` 형태
            if (msg.content.startsWith("__TASK_CREATED__:")) {
              return (
                <TaskCreatedCard
                  key={msg.id}
                  task={msg.task ?? null}
                  fallbackId={msg.content.slice("__TASK_CREATED__:".length)}
                  createdAt={msg.createdAt}
                />
              )
            }

            // 시스템 메시지 (구분선 스타일)
            if (msg._isSystem || msg.author.id === "system" || msg.content.startsWith("🤖")) {
              return (
                // 재구성 요약은 한 줄을 넘는다 — 줄바꿈 없이 두면 380px 패널 밖으로 잘렸다(2026-09-15 녹화)
                <div key={msg.id} className="mt-2 flex items-center gap-3 py-1">
                  <div className="min-w-4 flex-1 border-t border-dashed border-muted-foreground/20" />
                  <span className="max-w-[80%] break-keep text-center text-[11px] leading-snug text-muted-foreground in-data-[messenger]:text-[13.5px] [overflow-wrap:anywhere]">
                    {msg.content.startsWith("🤖") ? msg.content : `🤖 ${msg.content}`}
                  </span>
                  <div className="min-w-4 flex-1 border-t border-dashed border-muted-foreground/20" />
                </div>
              )
            }

            const mine = isMe && !selectionMode
            const flashing = flashId === msg.id
            const pending = msg.id.startsWith("temp-")
            const fresh = !msg._settled && new Date(msg.createdAt).getTime() > mountedAt
            return (
              <div
                key={msg.id}
                data-message-id={msg.id}
                className={`group/msg flex gap-2.5 rounded-lg transition-colors duration-700 in-data-[messenger]:gap-3 motion-reduce:transition-none ${mine ? "flex-row-reverse" : ""} ${
                  row.groupStart ? "mt-3 in-data-[messenger]:mt-5" : "mt-0.5 in-data-[messenger]:mt-1"
                } ${fresh ? MESSAGE_ENTER : ""} ${selectionMode ? "cursor-pointer" : ""} ${isSelected ? "bg-primary/5 ring-1 ring-primary/20 p-1" : ""} ${flashing ? "bg-amber-200/50 ring-2 ring-amber-400/60 dark:bg-amber-400/15" : ""}`}
                onClick={selectionMode ? () => onToggleSelect?.(msg.id) : undefined}
              >
                {selectionMode && (
                  <div className="flex items-start pt-1 shrink-0">
                    <Checkbox checked={isSelected} />
                  </div>
                )}
                {!mine && !selectionMode && (
                  // 묶음 안 줄은 아바타 자리를 비워 본문 줄을 맞춘다
                  row.groupStart ? <AuthorAvatar name={msg.author.name} size={30} lgSize={38} className="mt-5 in-data-[messenger]:mt-[27px]" /> : <span className="w-[30px] shrink-0 in-data-[messenger]:w-[38px]" />
                )}
                <div
                  className={`flex min-w-0 max-w-[78%] flex-col gap-1 ${mine ? "items-end in-data-[messenger]:max-w-[85%]" : "in-data-[messenger]:max-w-[calc(100%-50px)]"}`}
                >
                  {!isMe && row.groupStart && (
                    <span className="px-0.5 text-[12px] font-semibold text-foreground/80 in-data-[messenger]:text-[15.5px] in-data-[messenger]:text-foreground">
                      {msg.author.name}
                    </span>
                  )}
                  {/* 답장 인용 — 어떤 글에 답하는지 한 줄로만 보인다 */}
                  {msg.replyTo && (
                    <div
                      className={`max-w-full truncate rounded-md border-l-2 border-primary/40 bg-muted/60 px-2 py-1 text-[11px] text-muted-foreground in-data-[messenger]:px-3 in-data-[messenger]:py-1.5 in-data-[messenger]:text-[13.5px] ${
                        mine ? "text-right" : ""
                      }`}
                      title={msg.replyTo.content}
                    >
                      <span className="font-medium">{msg.replyTo.authorName}</span> · {msg.replyTo.content}
                    </div>
                  )}
                  <div className={`flex items-end gap-1 ${mine ? "flex-row-reverse" : ""}`}>
                    <div
                      data-message-body
                      className={`min-w-0 rounded-2xl px-3 py-2 text-[13.5px] leading-[1.6] in-data-[messenger]:rounded-[24px] in-data-[messenger]:px-[18px] in-data-[messenger]:py-[12px] in-data-[messenger]:text-[17px] ${
                        mine ? "bg-primary text-primary-foreground in-data-[messenger]:rounded-br-lg in-data-[messenger]:bg-primary/10 in-data-[messenger]:text-foreground" : "bg-muted"
                      } ${mine && !row.groupStart ? "rounded-tr-md" : ""} ${!mine && !row.groupStart ? "rounded-tl-md in-data-[messenger]:rounded-tl-lg" : ""} ${
                        msg.isTaskInstruction ? "ring-2 ring-primary/30" : ""
                      } ${pending ? "opacity-70" : ""} ${msg.deletedAt ? "bg-muted/50 italic text-muted-foreground" : ""} transition-opacity duration-300`}
                    >
                      {editingId === msg.id ? (
                        // 고치기는 말풍선 자리에서 한다 — 창을 띄우면 앞뒤 대화가 가려진다
                        <div className="flex flex-col gap-1">
                          <textarea
                            autoFocus
                            value={editDraft}
                            onChange={(e) => setEditDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") setEditingId(null)
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault()
                                const next = editDraft.trim()
                                if (!next || next === msg.content) return setEditingId(null)
                                setBusyId(msg.id)
                                void onEdit?.(msg.id, next).finally(() => {
                                  setBusyId(null)
                                  setEditingId(null)
                                })
                              }
                            }}
                            rows={Math.min(6, editDraft.split("\n").length + 1)}
                            className="w-[min(60vw,340px)] resize-none rounded-md bg-background p-1.5 text-[13.5px] text-foreground outline-none ring-1 ring-primary/40 in-data-[messenger]:w-[min(66vw,420px)] in-data-[messenger]:p-2 in-data-[messenger]:text-[16px]"
                          />
                          <span className="text-[10.5px] opacity-70 in-data-[messenger]:text-[12.5px]">Enter 저장 · Esc 취소</span>
                        </div>
                      ) : (
                        <>
                          <p className="whitespace-pre-wrap break-keep [overflow-wrap:anywhere]">
                            {msg.deletedAt ? (
                              msg.content
                            ) : (
                              <MessageContent content={tidyBody(msg.content)} tasks={tasks} isMe={mine} />
                            )}
                          </p>
                          {!msg.deletedAt && msg.files && msg.files.length > 0 && (
                            <MessageFiles files={msg.files} onPrimary={mine} />
                          )}
                        </>
                      )}
                    </div>
                    {/* 말풍선에 겹치지 않게 옆에 둔다. 손이 닿는 화면에서는 늘 보인다 */}
                    {!selectionMode && !pending && !msg.deletedAt && editingId !== msg.id && (
                      <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/msg:opacity-100">
                        {onReply && (
                          <button
                            type="button"
                            aria-label="답장"
                            title="답장"
                            onClick={() =>
                              onReply({ id: msg.id, authorName: msg.author.name, content: msg.content.slice(0, 80) })
                            }
                            className="rounded p-1 text-muted-foreground in-data-[messenger]:p-2 in-data-[messenger]:[&_svg]:size-[18px] hover:bg-muted"
                          >
                            <HugeiconsIcon icon={ArrowTurnBackwardIcon} size={13} />
                          </button>
                        )}
                        {isMe && onEdit && (
                          <button
                            type="button"
                            aria-label="수정"
                            title="수정"
                            onClick={() => {
                              setEditDraft(msg.content)
                              setEditingId(msg.id)
                            }}
                            className="rounded p-1 text-muted-foreground in-data-[messenger]:p-2 in-data-[messenger]:[&_svg]:size-[18px] hover:bg-muted"
                          >
                            <HugeiconsIcon icon={PencilEdit01Icon} size={13} />
                          </button>
                        )}
                        {isMe && onDelete && (
                          <button
                            type="button"
                            aria-label="삭제"
                            title="삭제"
                            disabled={busyId === msg.id}
                            onClick={() => {
                              if (!window.confirm("이 메시지를 지울까요? 자리는 남고 내용만 사라집니다.")) return
                              setBusyId(msg.id)
                              void onDelete(msg.id).finally(() => setBusyId(null))
                            }}
                            className="rounded p-1 text-muted-foreground in-data-[messenger]:p-2 in-data-[messenger]:[&_svg]:size-[18px] hover:bg-muted hover:text-destructive"
                          >
                            <HugeiconsIcon icon={Delete02Icon} size={13} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {(row.groupEnd || (msg.task && msg.nextTaskId !== msg.task.id)) && (
                    <div className="flex items-center gap-2 px-0.5">
                      {row.groupEnd &&
                        (pending && msg._failed ? (
                          // 보내지 못했다 — 예전에는 「보내는 중」 으로 영원히 남아 다시 보낼 길이 없었다
                          <span className="flex flex-wrap items-center gap-x-1 text-[10.5px] text-destructive in-data-[messenger]:text-[12.5px]" role="alert">
                            <span>{msg._failed}</span>
                            {onResend && (
                              <button
                                type="button"
                                onClick={() => onResend(msg.id)}
                                className="inline-flex min-h-11 items-center rounded px-2 font-medium underline underline-offset-2 hover:bg-destructive/10"
                              >
                                다시 보내기
                              </button>
                            )}
                            {onDiscardFailed && (
                              <button
                                type="button"
                                onClick={() => onDiscardFailed(msg.id)}
                                className="inline-flex min-h-11 items-center rounded px-2 text-muted-foreground hover:bg-muted"
                              >
                                지우기
                              </button>
                            )}
                          </span>
                        ) : pending ? (
                          <span className="flex items-center gap-1 text-[10.5px] text-muted-foreground in-data-[messenger]:text-[12.5px]" aria-live="polite">
                            <Spinner className="h-2.5 w-2.5" />
                            보내는 중…
                          </span>
                        ) : (
                          <span className="flex items-center gap-1">
                            <MessageTime iso={msg.createdAt} className="text-[10.5px]" />
                            {/* 고친 글임을 알린다 — 나중에 읽는 사람이 원문과 다름을 알아야 한다 */}
                            {msg.editedAt && !msg.deletedAt && (
                              <span className="text-[10px] text-muted-foreground in-data-[messenger]:text-[12px]">수정됨</span>
                            )}
                          </span>
                        ))}
                      {msg.task && (row.groupEnd || msg.nextTaskId !== msg.task.id) && (
                        <Link href={`/tasks/${msg.task.id}`} onClick={(e) => e.stopPropagation()} title={msg.task.name}>
                          <Badge variant="outline" className="max-w-[180px] cursor-pointer truncate text-[10px] in-data-[messenger]:h-6 in-data-[messenger]:px-2.5 in-data-[messenger]:text-[12.5px] transition-colors hover:bg-primary/10">
                            #{msg.task.slug}
                          </Badge>
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          {loadingNewer && (
            <div className="flex justify-center py-1">
              <Spinner className="h-4 w-4" />
            </div>
          )}
          {processingSlug && (
            <div className="flex items-center gap-2 rounded-lg bg-primary/5 border border-primary/10 px-3 py-2 animate-pulse">
              <div className="h-2 w-2 rounded-full bg-primary animate-bounce" />
              <span className="text-xs text-muted-foreground in-data-[messenger]:text-[14px]">
                <span className="font-medium text-primary">#{processingSlug}</span> 업무를 분석하고 있습니다...
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * 본문에서 링크로 만들 것들.
 *
 * 실제 대화를 보면 사람들이 URL(148건)과 `Z:\HADD Science\...` 같은 NAS 경로(27건)를
 * 그대로 붙여넣는다. 평문으로 두면 매번 복사해서 탐색기에 붙여야 한다.
 *
 * 순서가 중요하다 — URL 을 먼저 잡아야 주소 안의 `#`·`@` 가 멘션으로 오인되지 않는다.
 */
const TOKEN_RE = new RegExp(
  [
    "(https?://[^\\s<>\"']+)",                        // URL
    "([A-Za-z]:\\\\HADD Science\\\\[^\\n]*)",         // Z:\HADD Science\...
    "(\\\\\\\\[\\w.-]+\\\\HADD Science\\\\[^\\n]*)",   // \\서버\HADD Science\...
    // 멘션. 앞 글자가 영숫자·점이면 이메일 지역부라 사람 멘션이 아니다(a@b.com).
    "(#[a-z0-9가-힣-]+|(?<![A-Za-z0-9._%+-])@[a-z0-9가-힣]+)",
  ].join("|"),
  "gi",
)

/** 경로 끝에 붙은 문장부호는 경로가 아니다. */
function trimPathTail(p: string): string {
  return p.replace(/[\s.,!?)\]}"']+$/, "")
}

/**
 * NAS 경로가 어디서 끝나는지 정한다.
 *
 * 폴더 이름에 공백이 흔해서("62. HADD 홈페이지") 공백만으로는 끊을 수 없다.
 * 대신 **마지막 구분자 뒤 조각**에서 한국어 조사가 시작되면 거기서 자른다 —
 * "…\00. 회의록 에 넣어놨어요" 처럼 경로 뒤에 말이 이어지는 경우다.
 */
function cutPathTail(raw: string): string {
  const p = trimPathTail(raw)
  const sep = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"))
  if (sep < 0) return p
  const last = p.slice(sep + 1)
  // 조사·서술어가 공백 뒤에 붙은 자리를 찾는다
  const m = last.match(/\s(?:에|에서|에다|로|으로|을|를|은|는|이|가|와|과|의|도|만|까지|부터|한테|께)(?:\s|$)/)
  return m ? p.slice(0, sep + 1 + m.index!) : p
}

const fileSizeLabel = (size: number) =>
  size < 1024 ? `${size}B` : size < 1048576 ? `${Math.round(size / 1024)}KB` : `${(size / 1048576).toFixed(1)}MB`

/** 확장자로 아이콘과 짧은 형식 이름 — 파일 카드에서 무엇인지 먼저 보이게 */
function fileKind(name: string): { icon: typeof File01Icon; label: string; tone: string } {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : ""
  if (ext === "pdf") return { icon: Pdf01Icon, label: "PDF", tone: "text-red-600 bg-red-50 dark:bg-red-950/40 dark:text-red-300" }
  if (["ppt", "pptx", "key"].includes(ext)) return { icon: Ppt01Icon, label: "PPT", tone: "text-orange-600 bg-orange-50 dark:bg-orange-950/40 dark:text-orange-300" }
  if (["xls", "xlsx", "csv"].includes(ext)) return { icon: Xls01Icon, label: ext.toUpperCase(), tone: "text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300" }
  if (["doc", "docx", "hwp", "hwpx", "txt", "md"].includes(ext)) return { icon: Doc01Icon, label: ext.toUpperCase(), tone: "text-sky-700 bg-sky-50 dark:bg-sky-950/40 dark:text-sky-300" }
  if (["zip", "7z", "rar"].includes(ext)) return { icon: ZipIcon, label: ext.toUpperCase(), tone: "text-violet-700 bg-violet-50 dark:bg-violet-950/40 dark:text-violet-300" }
  return { icon: File01Icon, label: ext ? ext.toUpperCase() : "파일", tone: "text-muted-foreground bg-muted" }
}

/** 메시지에 붙은 파일 — 이미지는 미리보기, 나머지는 형식 아이콘 · 이름 · 크기 카드. 채팅과 업무 스레드가 같이 쓴다. */
export function MessageFiles({ files, onPrimary = false }: { files: FileInfo[]; onPrimary?: boolean }) {
  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {files.map((f) => {
        const isImage = f.mimeType?.startsWith("image/")
        const uploading = f._uploading

        if (isImage) {
          return (
            <a
              key={f.id}
              href={uploading ? undefined : apiUrl(f.path)}
              target="_blank"
              rel="noopener noreferrer"
              className={`block rounded-md overflow-hidden max-w-[200px] in-data-[messenger]:max-w-[260px] border ${uploading ? "opacity-60" : "hover:opacity-90"} transition-opacity`}
              onClick={(e) => { if (uploading) e.preventDefault(); e.stopPropagation() }}
            >
              <img src={apiUrl(f.path)} alt={f.name} className="w-full h-auto" loading="lazy" />
              <div className="relative px-1.5 py-0.5 text-[10px] in-data-[messenger]:text-[12.5px] text-muted-foreground bg-background/80 truncate overflow-hidden">
                {uploading && (
                  <div className="absolute inset-0 bg-primary/20 animate-[gauge_1.5s_ease-in-out_infinite]" />
                )}
                <span className="relative">{uploading ? "업로드 중..." : f.name}</span>
              </div>
            </a>
          )
        }
        const kind = fileKind(f.name)
        return (
          <a
            key={f.id}
            href={uploading ? undefined : apiUrl(f.path)}
            target="_blank"
            rel="noopener noreferrer"
            title={f.name}
            className={`relative flex max-w-[280px] items-center gap-2.5 overflow-hidden rounded-lg border px-2.5 py-2 in-data-[messenger]:max-w-[340px] in-data-[messenger]:gap-3 in-data-[messenger]:rounded-xl in-data-[messenger]:px-3 in-data-[messenger]:py-2.5 transition-colors ${
              onPrimary ? "border-white/25 bg-white/10 hover:bg-white/15 in-data-[messenger]:border-border in-data-[messenger]:bg-background in-data-[messenger]:hover:bg-muted/60" : "bg-background hover:bg-muted/60"
            } ${uploading ? "opacity-70" : ""}`}
            onClick={(e) => { if (uploading) e.preventDefault(); e.stopPropagation() }}
          >
            {uploading && (
              <div className="absolute inset-y-0 left-0 bg-primary/15 animate-[gauge_1.5s_ease-in-out_infinite]" />
            )}
            <span className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md in-data-[messenger]:size-[44px] in-data-[messenger]:[&_svg]:size-[22px] ${onPrimary ? "bg-white/20 text-white in-data-[messenger]:bg-muted in-data-[messenger]:text-foreground" : kind.tone}`}>
              <HugeiconsIcon icon={kind.icon} size={17} aria-hidden />
            </span>
            <span className="relative min-w-0 flex-1">
              <span className={`block truncate text-[12.5px] in-data-[messenger]:text-[15px] font-medium ${onPrimary ? "text-white in-data-[messenger]:text-foreground" : "text-foreground"}`}>{f.name}</span>
              <span className={`block text-[11px] in-data-[messenger]:text-[13px] ${onPrimary ? "text-white/70 in-data-[messenger]:text-muted-foreground" : "text-muted-foreground"}`}>
                {uploading ? "업로드 중..." : `${kind.label} · ${fileSizeLabel(f.size)}`}
              </span>
            </span>
          </a>
        )
      })}
    </div>
  )
}

export function MessageContent({ content, tasks, isMe = false }: { content: string; tasks: TaskRef[]; isMe?: boolean }) {
  // 링크 · 경로는 밑줄 글자, @사람 · #업무는 옅은 칩 — 본문과 한눈에 구분된다
  const mentionClass = isMe
    ? "font-medium text-white/90 underline decoration-white/40 hover:decoration-white in-data-[messenger]:text-blue-700 in-data-[messenger]:decoration-blue-700/40 dark:in-data-[messenger]:text-blue-300 dark:in-data-[messenger]:decoration-blue-300/40"
    : "font-medium text-blue-700 dark:text-blue-300 hover:underline"
  const chipClass = isMe
    ? "rounded bg-white/20 px-1 py-px font-medium text-white hover:bg-white/30 in-data-[messenger]:bg-blue-50 in-data-[messenger]:text-blue-700 dark:in-data-[messenger]:bg-blue-950/50 dark:in-data-[messenger]:text-blue-300"
    : "rounded bg-blue-50 px-1 py-px font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-900/60"

  const parts: React.ReactNode[] = []
  const regex = TOKEN_RE
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index))
    }

    const token = match[0]

    // 바깥 링크 — 새 탭에서 연다
    if (/^https?:\/\//i.test(token)) {
      const url = trimPathTail(token)
      parts.push(
        <a
          key={match.index}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={mentionClass}
          onClick={(e) => e.stopPropagation()}
        >
          {url}
        </a>,
      )
      if (token.length > url.length) parts.push(token.slice(url.length))
      lastIndex = match.index + match[0].length
      continue
    }

    // NAS 경로 — 옴니스가 중계해 연다. 브라우저는 NAS 에 직접 붙지 못한다.
    if (/HADD Science/i.test(token) && /[\\/]/.test(token)) {
      const raw = cutPathTail(token)
      parts.push(
        <Link
          key={match.index}
          href={`/omnis/nas?path=${encodeURIComponent(raw)}`}
          className={mentionClass}
          title="사내 시놀로지에서 열기"
          onClick={(e) => e.stopPropagation()}
        >
          {raw}
        </Link>,
      )
      if (token.length > raw.length) parts.push(token.slice(raw.length))
      lastIndex = match.index + match[0].length
      continue
    }

    if (token.startsWith("#")) {
      const slug = token.slice(1)
      const task = tasks.find((t) => t.slug === slug)
      if (task) {
        parts.push(
          <Link
            key={match.index}
            href={`/tasks/${task.id}`}
            className={chipClass}
            title={task.name}
            onClick={(e) => e.stopPropagation()}
          >
            {token}
          </Link>
        )
      } else {
        parts.push(<span key={match.index} className={chipClass}>{token}</span>)
      }
    } else {
      parts.push(<span key={match.index} className={chipClass}>{token}</span>)
    }
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex))
  }

  return <>{parts}</>
}

/** 업무 생성 시 채팅에 표시되는 프리뷰 카드 */
function TaskCreatedCard({
  task,
  fallbackId,
  createdAt,
}: {
  task: Message["task"]
  fallbackId: string
  createdAt: string
}) {
  const href = `/tasks/${task?.id ?? fallbackId}`
  const statusLabel = task?.status ? TASK_STATUS_LABELS[task.status] ?? task.status : null
  const deadlineLabel = task?.deadline ? format(new Date(task.deadline), "M월 d일") : null
  const checklistCount = task?._count?.checklists ?? 0

  return (
    <div className="flex flex-col items-center gap-1 py-1">
      <Link
        href={href}
        onClick={(e) => e.stopPropagation()}
        className="group flex w-full max-w-[88%] flex-col gap-2 rounded-xl border border-primary/25 bg-primary/[0.04] px-3.5 py-3 in-data-[messenger]:gap-2.5 in-data-[messenger]:rounded-2xl in-data-[messenger]:px-[18px] in-data-[messenger]:py-[14px] transition-colors hover:border-primary/45 hover:bg-primary/[0.07]"
      >
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-primary in-data-[messenger]:text-[13.5px]">
          <HugeiconsIcon icon={Task01Icon} size={13} className="in-data-[messenger]:size-[17px]" />
          새 업무가 생성되었습니다
        </div>

        <div className="text-[13px] font-semibold leading-snug text-foreground in-data-[messenger]:text-[16.5px]">
          {task?.name ?? "업무"}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {task?.slug && (
            <Badge variant="outline" className="text-[10px] in-data-[messenger]:h-6 in-data-[messenger]:text-[12.5px]">
              #{task.slug}
            </Badge>
          )}
          {statusLabel && (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium in-data-[messenger]:text-[12.5px] ${
                (task?.status && TASK_STATUS_COLORS[task.status]) ||
                "bg-muted text-muted-foreground"
              }`}
            >
              {statusLabel}
            </span>
          )}
          {task?.priority && (
            <span className="text-[10px] text-muted-foreground in-data-[messenger]:text-[12.5px]">
              {PRIORITY_LABELS[task.priority] ?? task.priority}
            </span>
          )}
        </div>

        {(task?.owner || deadlineLabel || checklistCount > 0) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px] text-muted-foreground in-data-[messenger]:text-[13px]">
            {task?.owner && <span>담당 {task.owner.name}</span>}
            {deadlineLabel && <span>마감 {deadlineLabel}</span>}
            {checklistCount > 0 && <span>체크리스트 {checklistCount}개</span>}
          </div>
        )}

        <span className="text-[10.5px] font-medium text-primary opacity-70 in-data-[messenger]:text-[13px] transition-opacity group-hover:opacity-100">
          업무 상세 보기 →
        </span>
      </Link>
      <span className="text-[10px] text-muted-foreground in-data-[messenger]:text-[12.5px]">
        {format(new Date(createdAt), "HH:mm")}
      </span>
    </div>
  )
}
