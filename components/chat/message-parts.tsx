"use client"

// 채팅 패널 · 업무 스레드가 같이 쓰는 메시지 목록 조각 — 날짜 구분선 · 아바타 · 사건 줄 · 시간.
// 배치 규칙(묶기 · 날짜 · 시간 문구)은 lib/chat-layout.
//
// 메신저 안(`data-messenger`, components/messenger/messenger-shell.tsx)에서는 `in-data-[messenger]:` 변형으로 크기를 키운다 —
// 오른쪽 패널 · 업무 상세는 이 셸 밖이라 그대로다.

import { HugeiconsIcon } from "@hugeicons/react"
import { AiMagicIcon, CheckmarkCircle02Icon, Clock01Icon, Task01Icon } from "@hugeicons/core-free-icons"
import { avatarText, avatarTone, fullTimeLabel, timeLabel } from "@/lib/chat-layout"
import { cn } from "@/lib/utils"

/** 날이 바뀔 때 한 줄 — 가운데 날짜, 양옆 가는 선 */
export function DayDivider({ label }: { label: string }) {
  return (
    <div role="separator" aria-label={label} className="flex items-center gap-3 py-2 in-data-[messenger]:gap-4 in-data-[messenger]:py-3">
      <div className="h-px flex-1 bg-border" />
      <span className="text-[11px] font-medium text-muted-foreground in-data-[messenger]:text-[13px]">{label}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}

/**
 * 이름마다 같은 색 · 한글 이름은 두 글자.
 * 크기는 px(--av). 메신저 안에서는 `lgSize`(--av-lg)를 쓴다 — 인라인 style 은 변형 클래스로 덮을 수 없어 변수로 받는다
 */
export function AuthorAvatar({
  name,
  size = 28,
  lgSize,
  className,
}: {
  name: string
  size?: number
  /** 메신저 안의 크기. 안 주면 `size` 와 같다 */
  lgSize?: number
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-(--av) shrink-0 select-none items-center justify-center rounded-full font-semibold tracking-tight text-(length:--av-fs) in-data-[messenger]:size-(--av-lg) in-data-[messenger]:text-(length:--av-lg-fs)",
        avatarTone(name),
        className,
      )}
      style={
        {
          "--av": `${size}px`,
          "--av-fs": `${Math.round(size * 0.36)}px`,
          "--av-lg": `${lgSize ?? size}px`,
          "--av-lg-fs": `${Math.round((lgSize ?? size) * 0.36)}px`,
        } as React.CSSProperties
      }
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
      className={cn("whitespace-nowrap text-[11px] tabular-nums text-muted-foreground in-data-[messenger]:text-[12.5px]", className)}
    >
      {compact ? timeLabel(d).replace(/^오[전후] /, "") : timeLabel(d)}
    </time>
  )
}

const EVENT_ICON = {
  TASK_CREATED: Task01Icon,
  TASK_REBUILT: AiMagicIcon,
  TASK_DONE: CheckmarkCircle02Icon,
  TASK_DONE_PENDING: Clock01Icon,
} as const

/**
 * 시스템 메시지 본문을 사건 줄 문구로 — "🤖 #slug 재구성 · 체크리스트 2/3 완료" → "업무를 갱신했습니다 · 체크리스트 2/3 완료".
 * 스레드는 이미 그 업무 안이라 #slug 는 군더더기다.
 */
export function eventSummary(kind: ChatEventKind, content: string): string {
  const rest = content.replace(/^🤖\s*/, "").replace(/^#[^\s]+\s*/, "")
  if (kind === "TASK_REBUILT") return `업무를 갱신했습니다 · ${rest.replace(/^재구성\s*·\s*/, "")}`
  return rest
}

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
    <div className="flex items-center gap-2 py-1 pl-9 text-[12px] text-muted-foreground in-data-[messenger]:gap-2.5 in-data-[messenger]:py-2 in-data-[messenger]:pl-[50px] in-data-[messenger]:text-[14px]">
      <HugeiconsIcon icon={EVENT_ICON[kind]} size={14} className="shrink-0 text-primary/70 in-data-[messenger]:size-[18px]" aria-hidden />
      <span className="min-w-0 break-keep">{children}</span>
      <MessageTime iso={iso} className="ml-auto shrink-0" />
    </div>
  )
}
