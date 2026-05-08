"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowUp01Icon, ArrowDown01Icon, Cancel01Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ChatPanel } from "./chat-panel"
import { TaskCmdModal } from "./task-cmd-modal"

interface Message {
  id: string
  content: string
  createdAt: string
  isTaskInstruction: boolean
  author: { id: string; name: string }
  task?: { id: string; name: string; slug: string } | null
}

interface ChatDockProps {
  open: boolean
  setOpen: (v: boolean) => void
  currentUserId: string
  initialMessages: Message[]
  onTaskUpdated?: () => void
}

type ThreadView = "all" | "ai"

interface ThreadTab {
  key: ThreadView
  label: string
  prefix?: string
  unread: number
}

const DOCK_HEIGHT_KEY = "omnis:dock-height"
const DOCK_CLOSED_HEIGHT = 40
const DOCK_MIN_OPEN_HEIGHT = 160
const DOCK_DEFAULT_OPEN_HEIGHT = 300

function clampOpenHeight(value: number): number {
  if (typeof window === "undefined") {
    return Math.max(DOCK_MIN_OPEN_HEIGHT, Math.min(DOCK_DEFAULT_OPEN_HEIGHT, value))
  }
  const max = Math.max(DOCK_MIN_OPEN_HEIGHT, Math.floor(window.innerHeight * 0.6))
  return Math.max(DOCK_MIN_OPEN_HEIGHT, Math.min(max, value))
}

export function ChatDock({
  open,
  setOpen,
  currentUserId,
  initialMessages,
  onTaskUpdated,
}: ChatDockProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const taskFilterId = searchParams.get("taskId")

  // 필터된 업무명 (initialMessages에서 추출, 없으면 ID 일부 표시)
  const taskFilterLabel = useMemo(() => {
    if (!taskFilterId) return null
    const found = initialMessages.find((m) => m.task?.id === taskFilterId)
    return found?.task?.name ?? taskFilterId.slice(0, 8)
  }, [taskFilterId, initialMessages])

  // 필터 활성화 시 dock 자동 열기
  useEffect(() => {
    if (taskFilterId && !open) setOpen(true)
  }, [taskFilterId, open, setOpen])

  function clearTaskFilter() {
    const params = new URLSearchParams(searchParams.toString())
    params.delete("taskId")
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
  }

  const [activeView, setActiveView] = useState<ThreadView>("all")
  const [taskModalOpen, setTaskModalOpen] = useState(false)
  const [taskModalRaw, setTaskModalRaw] = useState("")

  // 열린 상태에서의 높이(드래그로 조정). 닫힌 상태에선 40px.
  const [openHeight, setOpenHeight] = useState<number>(DOCK_DEFAULT_OPEN_HEIGHT)
  const [dragging, setDragging] = useState(false)
  const hasHydratedRef = useRef(false)

  const dragStateRef = useRef<{
    startY: number
    startHeight: number
    pointerId: number
  } | null>(null)

  // 초기 localStorage 복원
  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const raw = window.localStorage.getItem(DOCK_HEIGHT_KEY)
      if (raw) {
        const n = Number(raw)
        if (Number.isFinite(n)) {
          setOpenHeight(clampOpenHeight(n))
        }
      }
    } catch {
      /* noop */
    } finally {
      hasHydratedRef.current = true
    }
  }, [])

  // openHeight 변경 시 localStorage 동기화 (드래그 stale closure 회피)
  // 초기 hydration 전에는 덮어쓰지 않음
  useEffect(() => {
    if (typeof window === "undefined") return
    if (!hasHydratedRef.current) return
    try {
      window.localStorage.setItem(DOCK_HEIGHT_KEY, String(openHeight))
    } catch {
      /* noop */
    }
  }, [openHeight])

  // 드래그 중 body 스타일 제어 (select-none + cursor)
  useEffect(() => {
    if (typeof document === "undefined") return
    if (dragging) {
      const prevUserSelect = document.body.style.userSelect
      const prevCursor = document.body.style.cursor
      document.body.style.userSelect = "none"
      document.body.style.cursor = "ns-resize"
      return () => {
        document.body.style.userSelect = prevUserSelect
        document.body.style.cursor = prevCursor
      }
    }
  }, [dragging])

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // 닫혀있으면 드래그 시작 시 먼저 연다
      if (!open) {
        setOpen(true)
      }
      e.preventDefault()
      dragStateRef.current = {
        startY: e.clientY,
        startHeight: open ? openHeight : DOCK_DEFAULT_OPEN_HEIGHT,
        pointerId: e.pointerId,
      }
      try {
        ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
      } catch {
        /* noop */
      }
      setDragging(true)
    },
    [open, openHeight, setOpen],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const state = dragStateRef.current
      if (!state) return
      // 위로 드래그 → 높이 증가 (dock이 아래에서 위로 자람)
      const delta = state.startY - e.clientY
      const next = clampOpenHeight(state.startHeight + delta)
      setOpenHeight(next)
    },
    [],
  )

  const finishDrag = useCallback(
    (e?: React.PointerEvent<HTMLDivElement>) => {
      const state = dragStateRef.current
      if (!state) return
      try {
        if (e) (e.currentTarget as HTMLDivElement).releasePointerCapture(state.pointerId)
      } catch {
        /* noop */
      }
      dragStateRef.current = null
      setDragging(false)
      // persist는 openHeight 변경 effect가 담당
    },
    [],
  )

  const tabs: ThreadTab[] = [
    { key: "all", label: "전체", unread: 0 },
    { key: "ai", label: "Omnis AI", prefix: "✦", unread: 0 },
  ]

  const currentHeight = open ? openHeight : DOCK_CLOSED_HEIGHT

  return (
    <div
      data-testid="chat-dock"
      data-state={open ? "open" : "closed"}
      className="relative flex shrink-0 flex-col border-t bg-background/95 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur dark:shadow-[0_-4px_16px_rgba(0,0,0,0.35)]"
      style={{
        height: currentHeight,
        transition: dragging ? "none" : "height 180ms ease-out",
      }}
    >
      {/* 드래그 핸들 (상단 보더 위에 얹힘) */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="채팅 패널 크기 조정"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        className={[
          "absolute left-0 right-0 -top-1 z-20 h-2 cursor-ns-resize select-none",
          "transition-colors",
          dragging ? "bg-primary/40" : "hover:bg-primary/30",
        ].join(" ")}
      />

      <div
        className="relative flex h-10 shrink-0 items-center gap-0.5 overflow-hidden px-2"
        style={{ borderBottom: open ? "1px solid var(--border)" : "none" }}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setOpen(!open)}
          title={open ? "최소화" : "열기"}
          className="h-[26px] w-[26px] shrink-0"
        >
          <HugeiconsIcon icon={open ? ArrowDown01Icon : ArrowUp01Icon} size={14} />
        </Button>

        <div className="flex flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
          {taskFilterLabel && (
            <span
              className="inline-flex h-[26px] items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2 text-[11.5px] font-medium text-primary whitespace-nowrap"
              title={`이 업무 메시지만 표시: ${taskFilterLabel}`}
            >
              <span className="text-[10px] text-primary/80">#</span>
              <span className="max-w-[140px] truncate">{taskFilterLabel}</span>
              <button
                type="button"
                onClick={clearTaskFilter}
                aria-label="업무 필터 해제"
                className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded hover:bg-primary/20"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={10} />
              </button>
            </span>
          )}
          {tabs.map((t) => {
            const selected = activeView === t.key && open
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => {
                  setActiveView(t.key)
                  if (!open) setOpen(true)
                }}
                className={[
                  "inline-flex h-[26px] items-center gap-1.5 rounded-md border px-2.5 text-[12px] text-foreground transition-colors whitespace-nowrap",
                  selected
                    ? "border-border bg-muted"
                    : "border-transparent bg-transparent hover:bg-muted/50",
                ].join(" ")}
              >
                <span className="text-[11px] text-muted-foreground">
                  {t.prefix ?? "·"}
                </span>
                <span className={selected ? "font-medium" : "font-normal"}>{t.label}</span>
                {t.unread > 0 && (
                  <Badge variant="destructive" className="h-4 px-1.5 text-[9px] leading-none">
                    {t.unread}
                  </Badge>
                )}
              </button>
            )
          })}
        </div>

        {open && (
          <span className="shrink-0 px-2 font-mono text-[10.5px] text-muted-foreground">
            /업무로 업무 지시 · #업무명 멘션으로 스레드 재구성
          </span>
        )}
      </div>

      {open && (
        <div className="flex min-h-0 flex-1 flex-col">
          <ChatPanel
            roomId="default-room"
            initialMessages={initialMessages}
            currentUserId={currentUserId}
            onTaskUpdated={onTaskUpdated}
            filterTaskId={taskFilterId}
            onSlashTaskCommand={(raw) => {
              setTaskModalRaw(raw)
              setTaskModalOpen(true)
            }}
          />
        </div>
      )}

      <TaskCmdModal
        open={taskModalOpen}
        rawCommand={taskModalRaw}
        onClose={() => setTaskModalOpen(false)}
      />
    </div>
  )
}
