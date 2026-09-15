"use client"

// 채팅 패널 · 업무 스레드가 같이 쓰는 메시지 목록 조각 — 날짜 구분선 · 아바타 · 사건 줄 · 시간.
// 배치 규칙(묶기 · 날짜 · 시간 문구)은 lib/chat-layout.

import { HugeiconsIcon } from "@hugeicons/react"
import { CheckmarkCircle02Icon, Clock01Icon, Task01Icon } from "@hugeicons/core-free-icons"
import { avatarText, avatarTone, fullTimeLabel, timeLabel } from "@/lib/chat-layout"
import { cn } from "@/lib/utils"

/** 날이 바뀔 때 한 줄 — 가운데 날짜, 양옆 가는 선 */
export function DayDivider({ label }: { label: string }) {
  return (
    <div role="separator" aria-label={label} className="flex items-center gap-3 py-2">
      <div className="h-px flex-1 bg-border" />
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}

/** 이름마다 같은 색 · 한글 이름은 두 글자 */
export function AuthorAvatar({ name, size = 28, className }: { name: string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold tracking-tight",
        avatarTone(name),
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {avatarText(name)}
    </span>
  )
}

/** 줄 머리 시간 — 짧게 쓰고 전체 시각은 hover · 스크린리더로. compact 는 묶음 안 줄 여백에 넣는 "2:36" */
export function MessageTime({ iso, className, compact = false }: { iso: string; className?: string; compact?: boolean }) {
  const d = new Date(iso)
  return (
    <time
      dateTime={iso}
      title={fullTimeLabel(d)}
      className={cn("whitespace-nowrap text-[11px] tabular-nums text-muted-foreground", className)}
    >
      {compact ? timeLabel(d).replace(/^오[전후] /, "") : timeLabel(d)}
    </time>
  )
}

const EVENT_ICON = {
  TASK_CREATED: Task01Icon,
  TASK_DONE: CheckmarkCircle02Icon,
  TASK_DONE_PENDING: Clock01Icon,
} as const

export type ChatEventKind = keyof typeof EVENT_ICON

export function isChatEventKind(kind: string | undefined): kind is ChatEventKind {
  return !!kind && kind in EVENT_ICON
}

/** 업무 생성 · 완료 같은 사건 — 사람 메시지처럼 보이지 않게 작고 옅게 */
export function EventRow({
  kind,
  children,
  iso,
}: {
  kind: ChatEventKind
  children: React.ReactNode
  iso: string
}) {
  return (
    <div className="flex items-center gap-2 py-1 pl-9 text-[12px] text-muted-foreground">
      <HugeiconsIcon icon={EVENT_ICON[kind]} size={14} className="shrink-0 text-primary/70" aria-hidden />
      <span className="min-w-0 break-keep">{children}</span>
      <MessageTime iso={iso} className="ml-auto shrink-0" />
    </div>
  )
}
