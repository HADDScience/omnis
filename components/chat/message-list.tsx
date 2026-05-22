"use client"

import { useLayoutEffect, useRef } from "react"
import Link from "next/link"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "@/components/ui/spinner"
import { format } from "date-fns"
import { HugeiconsIcon } from "@hugeicons/react"
import { Task01Icon } from "@hugeicons/core-free-icons"
import { TASK_STATUS_LABELS, TASK_STATUS_COLORS, PRIORITY_LABELS } from "@/lib/constants"

interface FileInfo {
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
}

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
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevFirstIdRef = useRef<string | null>(null)
  const anchorRef = useRef<{ height: number; top: number } | null>(null)

  // 이전 메시지(prepend)면 스크롤 위치 유지, 그 외(새 메시지·초기 로드)는 맨 아래로
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
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
    } else {
      el.scrollTop = el.scrollHeight
    }
    prevFirstIdRef.current = firstId
  }, [messages])

  function handleScroll() {
    const el = scrollRef.current
    if (!el || !onLoadOlder) return
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
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="min-h-0 flex-1 overflow-y-auto px-4"
    >
      <div className="flex flex-col gap-3 py-4">
        {loadingOlder && (
          <div className="flex justify-center py-1">
            <Spinner className="h-4 w-4" />
          </div>
        )}
        {!hasMoreOlder && !loadingOlder && (
          <div className="py-1 text-center text-[10px] text-muted-foreground">
            — 대화의 시작 —
          </div>
        )}
        {messages.map((msg) => {
          const isMe = msg.author.id === currentUserId
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
              <div key={msg.id} className="flex items-center gap-3 py-1">
                <div className="flex-1 border-t border-dashed border-muted-foreground/20" />
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                  {msg.content.startsWith("🤖") ? msg.content : `🤖 ${msg.content}`}
                </span>
                <div className="flex-1 border-t border-dashed border-muted-foreground/20" />
              </div>
            )
          }

          return (
            <div
              key={msg.id}
              className={`flex gap-3 ${isMe ? "flex-row-reverse" : ""} ${
                selectionMode ? "cursor-pointer" : ""
              } ${isSelected ? "rounded-lg bg-primary/5 ring-1 ring-primary/20 p-1" : ""}`}
              onClick={selectionMode ? () => onToggleSelect?.(msg.id) : undefined}
            >
              {selectionMode && (
                <div className="flex items-start pt-1 shrink-0">
                  <Checkbox checked={isSelected} />
                </div>
              )}
              {!isMe && !selectionMode && (
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarFallback className="text-xs">
                    {msg.author.name.charAt(0)}
                  </AvatarFallback>
                </Avatar>
              )}
              <div
                className={`flex min-w-0 max-w-[70%] flex-col gap-1 ${isMe && !selectionMode ? "items-end" : ""}`}
              >
                {!isMe && (
                  <span className="text-xs text-muted-foreground">
                    {msg.author.name}
                  </span>
                )}
                <div
                  className={`rounded-lg px-3 py-2 text-sm break-words ${
                    isMe && !selectionMode
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  } ${msg.isTaskInstruction ? "ring-2 ring-primary/30" : ""}`}
                >
                  <p className="whitespace-pre-wrap break-words">
                    <MessageContent content={msg.content} tasks={tasks} isMe={isMe && !selectionMode} />
                  </p>
                  {msg.files && msg.files.length > 0 && (
                    <div className="flex flex-col gap-1.5 mt-1.5">
                      {msg.files.map((f) => {
                        const isImage = f.mimeType?.startsWith("image/")
                        const uploading = (f as FileInfo)._uploading

                        if (isImage) {
                          return (
                            <a
                              key={f.id}
                              href={uploading ? undefined : f.path}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`block rounded-md overflow-hidden max-w-[200px] border ${uploading ? "opacity-60" : "hover:opacity-90"} transition-opacity`}
                              onClick={(e) => { if (uploading) e.preventDefault(); e.stopPropagation() }}
                            >
                              <img src={f.path} alt={f.name} className="w-full h-auto" loading="lazy" />
                              <div className="relative px-1.5 py-0.5 text-[10px] text-muted-foreground bg-background/80 truncate overflow-hidden">
                                {uploading && (
                                  <div className="absolute inset-0 bg-primary/20 animate-[gauge_1.5s_ease-in-out_infinite]" />
                                )}
                                <span className="relative">{uploading ? "업로드 중..." : f.name}</span>
                              </div>
                            </a>
                          )
                        }
                        return (
                          <a
                            key={f.id}
                            href={uploading ? undefined : f.path}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`flex items-center gap-1.5 rounded bg-background/50 px-2 py-1 text-[11px] ${uploading ? "opacity-70" : "hover:underline"} relative overflow-hidden`}
                            onClick={(e) => { if (uploading) e.preventDefault(); e.stopPropagation() }}
                          >
                            {uploading && (
                              <div className="absolute inset-y-0 left-0 bg-primary/15 animate-[gauge_1.5s_ease-in-out_infinite]" />
                            )}
                            <span className="truncate relative">{f.name}</span>
                            <span className="shrink-0 text-muted-foreground relative">
                              {uploading ? "업로드 중..." : f.size < 1024 ? `${f.size}B` : f.size < 1048576 ? `${Math.round(f.size / 1024)}KB` : `${(f.size / 1048576).toFixed(1)}MB`}
                            </span>
                          </a>
                        )
                      })}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">
                    {format(new Date(msg.createdAt), "HH:mm")}
                  </span>
                  {msg.task && (
                    <Link href={`/tasks/${msg.task.id}`} onClick={(e) => e.stopPropagation()}>
                      <Badge variant="outline" className="text-[10px] cursor-pointer hover:bg-primary/10 transition-colors">
                        #{msg.task.slug}
                      </Badge>
                    </Link>
                  )}
                </div>
              </div>
            </div>
          )
        })}
        {processingSlug && (
          <div className="flex items-center gap-2 rounded-lg bg-primary/5 border border-primary/10 px-3 py-2 animate-pulse">
            <div className="h-2 w-2 rounded-full bg-primary animate-bounce" />
            <span className="text-xs text-muted-foreground">
              <span className="font-medium text-primary">#{processingSlug}</span> 업무를 분석하고 있습니다...
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function MessageContent({ content, tasks, isMe = false }: { content: string; tasks: TaskRef[]; isMe?: boolean }) {
  if (tasks.length === 0) return <>{content}</>

  const mentionClass = isMe
    ? "font-medium text-white/90 underline decoration-white/40 hover:decoration-white"
    : "font-medium text-blue-700 dark:text-blue-300 hover:underline"

  const parts: React.ReactNode[] = []
  const regex = /(#[a-z0-9가-힣-]+|@[a-z0-9가-힣]+)/gi
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index))
    }

    const token = match[0]
    if (token.startsWith("#")) {
      const slug = token.slice(1)
      const task = tasks.find((t) => t.slug === slug)
      if (task) {
        parts.push(
          <Link
            key={match.index}
            href={`/tasks/${task.id}`}
            className={mentionClass}
            onClick={(e) => e.stopPropagation()}
          >
            {token}
          </Link>
        )
      } else {
        parts.push(<span key={match.index} className={mentionClass}>{token}</span>)
      }
    } else {
      parts.push(<span key={match.index} className={mentionClass}>{token}</span>)
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
        className="group flex w-full max-w-[88%] flex-col gap-2 rounded-xl border border-primary/25 bg-primary/[0.04] px-3.5 py-3 transition-colors hover:border-primary/45 hover:bg-primary/[0.07]"
      >
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-primary">
          <HugeiconsIcon icon={Task01Icon} size={13} />
          새 업무가 생성되었습니다
        </div>

        <div className="text-[13px] font-semibold leading-snug text-foreground">
          {task?.name ?? "업무"}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {task?.slug && (
            <Badge variant="outline" className="text-[10px]">
              #{task.slug}
            </Badge>
          )}
          {statusLabel && (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                (task?.status && TASK_STATUS_COLORS[task.status]) ||
                "bg-muted text-muted-foreground"
              }`}
            >
              {statusLabel}
            </span>
          )}
          {task?.priority && (
            <span className="text-[10px] text-muted-foreground">
              {PRIORITY_LABELS[task.priority] ?? task.priority}
            </span>
          )}
        </div>

        {(task?.owner || deadlineLabel || checklistCount > 0) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px] text-muted-foreground">
            {task?.owner && <span>담당 {task.owner.name}</span>}
            {deadlineLabel && <span>마감 {deadlineLabel}</span>}
            {checklistCount > 0 && <span>체크리스트 {checklistCount}개</span>}
          </div>
        )}

        <span className="text-[10.5px] font-medium text-primary opacity-70 transition-opacity group-hover:opacity-100">
          업무 상세 보기 →
        </span>
      </Link>
      <span className="text-[10px] text-muted-foreground">
        {format(new Date(createdAt), "HH:mm")}
      </span>
    </div>
  )
}
