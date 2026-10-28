"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { BubbleChatSparkIcon, Building03Icon, PencilEdit02Icon, Task01Icon, UserGroupIcon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { TASK_STATUS_LABELS } from "@/lib/constants"
import { timeLabel } from "@/lib/chat-layout"
import { apiUrl } from "@/lib/base-path"
import { cn } from "@/lib/utils"
import type { RoomList as RoomListData, RoomListItem } from "@/lib/chat-rooms"

/** 전사방 · 업무방은 다른 사람이 글을 쓴다 — 목록을 열어 둔 동안 이 간격으로 다시 읽는다 */
const POLL_MS = 30_000

function roomHref(r: RoomListItem): string {
  return r.kind === "TASK" ? `/chat/task/${r.id}` : `/chat/${r.id}`
}

/** 오늘이면 「오후 2:08」, 올해면 「10월 3일」, 그 전이면 「2025. 10. 3.」 */
function listTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return timeLabel(d)
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}월 ${d.getDate()}일`
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`
}

/**
 * 메신저 왼쪽 목록. 옴니스 1:1 방 → 전사방 → 단톡방(5단계, 자리만) → 업무방(최근 글 순).
 * `version` 이 오르면 다시 읽는다 — 방 화면이 새 대화를 만들거나 답을 받았을 때 올린다.
 */
export function RoomList({ version }: { version: number }) {
  const pathname = usePathname()
  const [data, setData] = useState<RoomListData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/api/chat/rooms"))
      if (!res.ok) throw new Error(`목록을 불러오지 못했습니다 (${res.status})`)
      setData((await res.json()) as RoomListData)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "목록을 불러오지 못했습니다")
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, version])

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load()
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [load])

  const isActive = (r: RoomListItem) => pathname === roomHref(r)

  return (
    <nav aria-label="채팅방" className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-2">
      {error && !data && (
        <div role="alert" className="mx-3 mb-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-[12.5px]">
          <p className="text-destructive">{error}</p>
          <Button variant="outline" size="sm" className="touch-target mt-2" onClick={() => void load()}>
            다시 불러오기
          </Button>
        </div>
      )}

      <Section title="옴니스">
        <Link
          href="/chat/new"
          aria-current={pathname === "/chat/new" ? "page" : undefined}
          className={cn(ROW, pathname === "/chat/new" && ROW_ACTIVE)}
        >
          <RoomIcon className="bg-primary/10 text-primary">
            <HugeiconsIcon icon={PencilEdit02Icon} size={16} aria-hidden />
          </RoomIcon>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium">새 대화</span>
            <span className="block truncate text-[11.5px] text-muted-foreground">옴니스에게 회사 일을 물어보세요</span>
          </span>
        </Link>
        {data === null && !error ? (
          <RowSkeletons count={3} />
        ) : (
          data?.omnis.map((r) => <RoomRow key={r.id} room={r} active={isActive(r)} />)
        )}
      </Section>

      <Section title="전사방">
        {data === null && !error ? (
          <RowSkeletons count={1} />
        ) : data && data.company.length === 0 ? (
          <EmptyLine>아직 전사방이 없어요. 오른쪽 위 채팅 버튼으로 팀 채팅에 첫 글을 남기면 생깁니다.</EmptyLine>
        ) : (
          data?.company.map((r) => <RoomRow key={r.id} room={r} active={isActive(r)} />)
        )}
      </Section>

      <Section title="단톡방">
        {data && data.groups.length > 0 ? (
          data.groups.map((r) => <RoomRow key={r.id} room={r} active={isActive(r)} />)
        ) : (
          <div className={cn(ROW, "cursor-default hover:bg-transparent")} aria-disabled>
            <RoomIcon className="bg-muted text-muted-foreground">
              <HugeiconsIcon icon={UserGroupIcon} size={16} aria-hidden />
            </RoomIcon>
            <span className="min-w-0 flex-1 text-[12px] text-muted-foreground">팀원과 단톡방은 곧 만들 수 있어요</span>
          </div>
        )}
      </Section>

      <Section title="업무방" hint="최근 글 순">
        {data === null && !error ? (
          <RowSkeletons count={5} />
        ) : data && data.tasks.length === 0 ? (
          <EmptyLine>업무 스레드에 글이 생기면 여기에 업무방으로 모입니다.</EmptyLine>
        ) : (
          data?.tasks.map((r) => <RoomRow key={r.id} room={r} active={isActive(r)} />)
        )}
      </Section>
    </nav>
  )
}

// 터치 기기에서 44px — .touch-target 은 px 고정이라 rem 배율(81.25%)을 타지 않는다(ux-rules 30)
const ROW =
  "touch-target mx-2 flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
const ROW_ACTIVE = "bg-muted hover:bg-muted"

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="mb-3">
      <h2 className="flex items-baseline gap-1.5 px-4 pb-1 pt-1.5 text-[11px] font-semibold text-muted-foreground">
        {title}
        {hint && <span className="font-normal opacity-80">· {hint}</span>}
      </h2>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  )
}

function RoomIcon({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span aria-hidden className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", className)}>
      {children}
    </span>
  )
}

function RoomRow({ room, active }: { room: RoomListItem; active: boolean }) {
  const icon =
    room.kind === "OMNIS_DM" ? (
      <RoomIcon className="ai-rainbow-border bg-primary/10 text-primary">
        <HugeiconsIcon icon={BubbleChatSparkIcon} size={16} />
      </RoomIcon>
    ) : room.kind === "COMPANY" ? (
      <RoomIcon className="bg-sky-500/10 text-sky-700 dark:text-sky-300">
        <HugeiconsIcon icon={Building03Icon} size={16} />
      </RoomIcon>
    ) : room.kind === "TASK" ? (
      <RoomIcon className="bg-amber-500/10 text-amber-700 dark:text-amber-300">
        <HugeiconsIcon icon={Task01Icon} size={16} />
      </RoomIcon>
    ) : (
      <RoomIcon className="bg-muted text-muted-foreground">
        <HugeiconsIcon icon={UserGroupIcon} size={16} />
      </RoomIcon>
    )
  return (
    <Link href={roomHref(room)} aria-current={active ? "page" : undefined} className={cn(ROW, active && ROW_ACTIVE)}>
      {icon}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
            {room.kind === "TASK" && <span className="mr-0.5 text-muted-foreground">#</span>}
            {room.name}
          </span>
          <time dateTime={room.lastAt} className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground">
            {listTime(room.lastAt)}
          </time>
        </span>
        <span className="flex items-center gap-1.5">
          {room.status && (
            <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
              {TASK_STATUS_LABELS[room.status] ?? room.status}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground">{room.preview ?? "아직 글이 없어요"}</span>
        </span>
      </span>
    </Link>
  )
}

function RowSkeletons({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="mx-2 flex items-center gap-2.5 px-2 py-1.5" aria-hidden>
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-2.5 w-full" />
          </span>
        </div>
      ))}
    </>
  )
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="mx-4 rounded-md border border-dashed px-3 py-2 text-[11.5px] text-muted-foreground">{children}</p>
}
