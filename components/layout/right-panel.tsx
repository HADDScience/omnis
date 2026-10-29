"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { ChatPanel } from "@/components/chat/chat-panel"
import { TaskCmdModal } from "@/components/chat/task-cmd-modal"
import { TaskThread } from "@/app/(main)/tasks/[taskId]/task-sidebar"
import { useRightPanel } from "./right-panel-context"
import { PanelOmnis } from "./panel-omnis"
import { cn } from "@/lib/utils"
import { apiUrl } from "@/lib/base-path"

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

// 「옴니스」 탭(2026-10-29 되살림) — 예전 「Omnis AI」(Gemini 한 번 묻기)가 아니라 에이전트 런타임의 옴니스 1:1 방을 끼운다.
// 쓰기는 방 화면과 같은 확인 카드를 거친다(PanelOmnis → OmnisRoom)
type View = "task" | "all" | "omnis"

/**
 * 오른쪽에서 열리는 하나의 패널.
 *
 * 예전에는 화면 아래에 붙은 독이었다. 세로로 흐르는 대화가 세로 공간을 본문과
 * 나눠 먹어서, 열면 본문이 절반으로 눌리고 닫으면 대화가 안 보였다.
 *
 * 그래서 **덮어서** 연다. 닫혀 있을 때 폭은 0 이다 — 접힌 레일조차 두지 않는다.
 * 스레드 하나 때문에 모든 화면이 좁아질 이유가 없다. 여는 곳은 오른쪽 아래의 둥근 유리 단추(PanelDock) ·
 * C 키 · ⌘⇧F · ?taskId= 링크다(2026-10-29, 제목줄의 「채팅 열기」 는 지웠다).
 *
 * 업무 상세에서 열면 전체 채팅이 아니라 **그 업무 스레드**가 먼저 뜬다.
 */
export function RightPanel({ currentUserId, initialMessages, onTaskUpdated }: Props) {
  const { open, setOpen, task, requestedView, clearRequestedView } = useRightPanel()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const urlTaskId = searchParams.get("taskId")

  const [view, setView] = useState<View>("all")
  const [recentThreads, setRecentThreads] = useState<RecentThread[]>([])
  const [taskModalOpen, setTaskModalOpen] = useState(false)
  const [taskModalRaw, setTaskModalRaw] = useState("")
  const [searchOpen, setSearchOpen] = useState(false)

  // 검색창은 전체 채팅에만 있다 — 탭을 옮기거나 패널을 닫으면 접는다
  useEffect(() => {
    if (!open || view !== "all") setSearchOpen(false)
  }, [open, view])

  // ⌘⇧F (윈도우는 Ctrl+Shift+F) — 어디서든 패널을 열고 전체 채팅 검색 줄로 간다. 이미 열려 있으면 검색칸을 다시 고른다.
  // 입력칸 안에서도 받는다 — 글을 쓰다가 바로 찾는 게 단축키의 쓸모다
  const [searchFocus, setSearchFocus] = useState(0)
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey) return
      if (e.code !== "KeyF" && e.key.toLowerCase() !== "f") return
      e.preventDefault()
      setOpen(true)
      setView("all")
      setSearchOpen(true)
      setSearchFocus((n) => n + 1)
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [setOpen])

  // 업무 화면으로 들어오면 그 업무 스레드로, 떠나면 전체로 되돌린다
  useEffect(() => {
    setView(task ? "task" : "all")
  }, [task])

  // 밖에서 탭을 지정해 열었으면 그쪽을 보여 준다. 한 번 쓰고 지운다 —
  // 남겨 두면 다음에 그냥 열었을 때도 그 탭으로 끌려간다.
  useEffect(() => {
    if (!requestedView) return
    setView(requestedView)
    clearRequestedView()
  }, [requestedView, clearRequestedView])

  // ?taskId= 로 들어온 딥링크는 패널을 열고 그 스레드를 보여 준다.
  //
  // "지금 taskId 가 있고 닫혀 있으면 연다" 로 두면 안 된다 — 스레드를 고른 상태에서
  // 닫기를 누르는 순간 taskId 는 그대로라 즉시 다시 열려서, 아예 닫히지 않는다.
  // 그래서 taskId 가 **바뀐 순간**에만 연다.
  const openedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!urlTaskId) {
      openedFor.current = null
      return
    }
    if (openedFor.current === urlTaskId) return
    openedFor.current = urlTaskId
    setOpen(true)
  }, [urlTaskId, setOpen])

  const loadRecentThreads = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/api/chat/threads/recent"))
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
      // ?taskId= 는 이 패널만 읽는다. router.replace 로 바꾸면 서버가 지금 화면(업무면 682건)을 통째로
      // 다시 그려, 스레드를 고를 때마다 그만큼 멈췄다 — 주소만 바꾼다(useSearchParams 는 따라온다)
      window.history.replaceState(null, "", `${pathname}${p.toString() ? `?${p}` : ""}`)
    },
    [pathname, searchParams]
  )

  const tabs = useMemo(() => {
    const list: { key: View; label: string; hint?: string }[] = []
    if (task) list.push({ key: "task", label: "이 업무", hint: task.name })
    list.push({ key: "all", label: "전체", hint: "전사 채팅" })
    list.push({ key: "omnis", label: "옴니스", hint: "옴니스와 1:1 — 쓰기는 확인 카드를 거친다" })
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

      {/* 둥근 유리 판 — nav 와 같은 질감(.glass)의 가장자리 빛 · 그림자, 화면 가장자리에서 띄운다.
          속은 읽기 좋게 거의 불투명한 바탕을 깐다(유리는 크롬에만 — ux-rules 떠 있는 nav) */}
      <aside
        data-onboarding="conversation"
        aria-hidden={!open}
        aria-label="대화 패널"
        className={cn(
          "glass fixed! top-[calc(var(--demo-banner-height,0px)+8px)] right-2 bottom-2 z-[var(--z-banner)] flex flex-col overflow-hidden rounded-[22px] transition-[transform,opacity] duration-200 motion-reduce:transition-none",
          // 92vw 를 그대로 쓰면 안 된다 — vw 는 zoom 을 모르므로 배율만큼 화면을 넘친다
          // (--app-vh 주석과 같은 함정). zoom 을 나눈 --app-vw 로 계산한다.
          "w-[min(400px,calc(var(--app-vw)-16px))]",
          open ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-[calc(100%+16px)] opacity-0"
        )}
      >
        <div className="flex shrink-0 items-center gap-1.5 px-2.5 pt-2.5 pb-2">
          {/* 탭은 nav 처럼 캡슐 하나 + 현재 탭만 한 겹 더 진한 유리(.glass-pill) */}
          <div role="group" aria-label="패널 보기" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded-full bg-muted/60 p-1 [scrollbar-width:none]">
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
                  "touch-target inline-flex h-7 min-w-0 shrink-0 items-center justify-center gap-1 rounded-full px-3 text-[12px] whitespace-nowrap transition-[color,transform] duration-150 active:scale-[0.96] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  view === t.key ? "glass-pill bg-background font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
                  t.key === "omnis" && view === t.key && "text-primary"
                )}
              >
                {t.key === "task" ? <span className="max-w-[7.5rem] truncate">{t.label}</span> : t.label}
              </button>
            ))}
          </div>
          {view === "all" && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="touch-target rounded-full"
              aria-label="채팅 검색"
              aria-pressed={searchOpen}
              title="채팅 검색 (⌘⇧F)"
              onClick={() => setSearchOpen((v) => !v)}
            >
              <HugeiconsIcon icon={Search01Icon} size={15} aria-hidden />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            className="touch-target rounded-full"
            aria-label="패널 닫기"
            title="패널 닫기 (C)"
            onClick={() => setOpen(false)}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={15} aria-hidden />
          </Button>
        </div>
        {/* 지금 보는 범위 — 이 업무 스레드 · 전체에서 업무 하나만 거른 중 */}
        {view === "task" && task && (
          <p className="shrink-0 truncate px-4 pb-1.5 text-[11.5px] text-muted-foreground">
            <span className="mr-0.5 opacity-60">#</span>
            {task.name} 스레드
          </p>
        )}

        {/* 열려 있을 때만 내용을 만든다 — 닫힌 패널이 3초마다 폴링할 이유가 없다 */}
        {open && (
          // pb-safe: 안드로이드 제스처바·홈 인디케이터에 입력창이 가리지 않게
          <div className="pb-safe mx-1.5 mb-1.5 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[18px] border bg-background">
            {view === "omnis" ? (
              <div className="flex min-h-0 flex-1 flex-col pt-2">
                <PanelOmnis userId={currentUserId} />
              </div>
            ) : view === "task" && task ? (
              <TaskThread taskId={task.id} taskName={task.name} messages={task.messages} currentUserId={currentUserId} />
            ) : (
              <>
                {recentThreads.length > 0 && (
                  <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b px-2 py-1.5 [scrollbar-width:none]" aria-label="업무 스레드로 거르기">
                    <button
                      type="button"
                      onClick={() => setTaskFilter(null)}
                      className={cn(
                        "inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-[11px]",
                        !urlTaskId ? "bg-foreground font-medium text-background" : "text-muted-foreground hover:bg-muted"
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
                          "inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-[11px]",
                          urlTaskId === t.id ? "bg-foreground font-medium text-background" : "text-muted-foreground hover:bg-muted"
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
                  searchOpen={searchOpen}
                  onSearchOpenChange={setSearchOpen}
                  searchFocus={searchFocus}
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
