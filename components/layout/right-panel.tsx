"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { ChatPanel } from "@/components/chat/chat-panel"
import { TaskCmdModal } from "@/components/chat/task-cmd-modal"
import { OmnisAsk } from "@/components/omnis/omnis-ask"
import { TaskThread } from "@/app/(main)/tasks/[taskId]/task-sidebar"
import { useRightPanel } from "./right-panel-context"
import { cn } from "@/lib/utils"

interface Message {
  id: string
  content: string
  createdAt: string
  isTaskInstruction: boolean
  author: { id: string; name: string }
  task?: { id: string; name: string; slug: string } | null
}

interface Props {
  currentUserId: string
  initialMessages: Message[]
  onTaskUpdated?: () => void
}

interface RecentThread {
  id: string
  name: string
  slug: string
}

type View = "task" | "all" | "ai"

/**
 * 오른쪽에서 열리는 하나의 패널.
 *
 * 예전에는 화면 아래에 붙은 독이었다. 세로로 흐르는 대화가 세로 공간을 본문과
 * 나눠 먹어서, 열면 본문이 절반으로 눌리고 닫으면 대화가 안 보였다.
 *
 * 그래서 **덮어서** 연다. 닫혀 있을 때 폭은 0 이다 — 접힌 레일조차 두지 않는다.
 * 스레드 하나 때문에 모든 화면이 좁아질 이유가 없다. 여는 곳은 헤더의 버튼 하나다.
 *
 * 업무 상세에서 열면 전체 채팅이 아니라 **그 업무 스레드**가 먼저 뜬다.
 */
export function RightPanel({ currentUserId, initialMessages, onTaskUpdated }: Props) {
  const { open, setOpen, task } = useRightPanel()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const urlTaskId = searchParams.get("taskId")

  const [view, setView] = useState<View>("all")
  const [recentThreads, setRecentThreads] = useState<RecentThread[]>([])
  const [taskModalOpen, setTaskModalOpen] = useState(false)
  const [taskModalRaw, setTaskModalRaw] = useState("")

  // 업무 화면으로 들어오면 그 업무 스레드로, 떠나면 전체로 되돌린다
  useEffect(() => {
    setView(task ? "task" : "all")
  }, [task])

  // ?taskId= 로 들어온 딥링크는 패널을 열고 그 스레드를 보여 준다
  useEffect(() => {
    if (urlTaskId && !open) setOpen(true)
  }, [urlTaskId, open, setOpen])

  const loadRecentThreads = useCallback(async () => {
    try {
      const res = await fetch("/api/chat/threads/recent")
      if (res.ok) setRecentThreads(await res.json())
    } catch {
      // 최근 스레드는 편의 기능이라 실패해도 패널은 그대로 쓴다
    }
  }, [])

  useEffect(() => {
    if (open) void loadRecentThreads()
  }, [open, loadRecentThreads])

  const setTaskFilter = useCallback(
    (id: string | null) => {
      const p = new URLSearchParams(searchParams.toString())
      if (id) p.set("taskId", id)
      else p.delete("taskId")
      router.replace(`${pathname}${p.toString() ? `?${p}` : ""}`, { scroll: false })
    },
    [pathname, router, searchParams]
  )

  const tabs = useMemo(() => {
    const list: { key: View; label: string; hint?: string }[] = []
    if (task) list.push({ key: "task", label: "이 업무", hint: task.name })
    list.push({ key: "all", label: "전체" })
    list.push({ key: "ai", label: "Omnis AI" })
    return list
  }, [task])

  return (
    <>
      {/* 좁은 화면에서 뒤를 덮는 막. 넓은 화면에서는 본문을 계속 볼 수 있게 둔다 */}
      {open && (
        <button
          type="button"
          aria-label="패널 닫기"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-[var(--z-dock)] bg-black/20 lg:hidden"
        />
      )}

      <aside
        aria-hidden={!open}
        className={cn(
          "fixed right-0 top-0 z-[var(--z-banner)] flex h-[var(--app-vh)] flex-col border-l bg-background shadow-[-4px_0_16px_rgba(0,0,0,0.08)] transition-transform duration-200 motion-reduce:transition-none dark:shadow-[-4px_0_16px_rgba(0,0,0,0.35)]",
          "w-[min(380px,92vw)]",
          open ? "translate-x-0" : "pointer-events-none translate-x-full"
        )}
      >
        <div className="flex h-11 shrink-0 items-center gap-1 border-b px-2">
          <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => {
                  setView(t.key)
                  if (t.key !== "all" && urlTaskId) setTaskFilter(null)
                }}
                aria-pressed={view === t.key}
                title={t.hint ?? t.label}
                className={cn(
                  "inline-flex h-7 shrink-0 items-center rounded-md border px-2.5 text-[12px] whitespace-nowrap transition-colors",
                  view === t.key
                    ? "border-primary/30 bg-primary/10 font-medium text-primary"
                    : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
                  t.key === "ai" && view === t.key && "ai-rainbow-border"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="패널 닫기"
            title="패널 닫기 (C)"
            onClick={() => setOpen(false)}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={15} aria-hidden />
          </Button>
        </div>

        {/* 열려 있을 때만 내용을 만든다 — 닫힌 패널이 3초마다 폴링할 이유가 없다 */}
        {open && (
          <div className="flex min-h-0 flex-1 flex-col">
            {view === "task" && task ? (
              <TaskThread taskId={task.id} taskName={task.name} messages={task.messages} />
            ) : view === "ai" ? (
              <OmnisAsk variant="dock" />
            ) : (
              <>
                {recentThreads.length > 0 && (
                  <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b px-2 py-1.5 [scrollbar-width:none]">
                    <button
                      type="button"
                      onClick={() => setTaskFilter(null)}
                      className={cn(
                        "inline-flex h-6 shrink-0 items-center rounded px-1.5 text-[11px]",
                        !urlTaskId ? "bg-muted font-medium" : "text-muted-foreground"
                      )}
                    >
                      전체
                    </button>
                    {recentThreads.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setTaskFilter(t.id)}
                        title={`#${t.name} 스레드만 보기`}
                        className={cn(
                          "inline-flex h-6 shrink-0 items-center rounded px-1.5 text-[11px]",
                          urlTaskId === t.id ? "bg-muted font-medium" : "text-muted-foreground"
                        )}
                      >
                        <span className="mr-0.5 opacity-60">#</span>
                        <span className="max-w-[110px] truncate">{t.name}</span>
                      </button>
                    ))}
                  </div>
                )}
                <ChatPanel
                  roomId="default-room"
                  initialMessages={initialMessages}
                  currentUserId={currentUserId}
                  onTaskUpdated={onTaskUpdated}
                  filterTaskId={urlTaskId}
                  onSlashTaskCommand={(raw) => {
                    setTaskModalRaw(raw)
                    setTaskModalOpen(true)
                  }}
                />
              </>
            )}
          </div>
        )}
      </aside>

      <TaskCmdModal
        open={taskModalOpen}
        rawCommand={taskModalRaw}
        onClose={() => setTaskModalOpen(false)}
      />
    </>
  )
}
