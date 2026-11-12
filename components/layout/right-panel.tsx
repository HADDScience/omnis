"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { TaskThread } from "@/app/(main)/tasks/[taskId]/task-sidebar"
import { useMediaQuery } from "@/hooks/use-media-query"
import { useShortcut } from "@/hooks/use-shortcuts"
import { closesPanelOn, type PanelRoomRef } from "@/lib/panel-chat-rules"
import { NAV_DESKTOP_QUERY } from "./floating-nav"
import { useRightPanel, type PanelView } from "./right-panel-context"
import { PanelMessenger } from "./panel-messenger"
import { cn } from "@/lib/utils"

interface Props {
  currentUserId: string
}

/**
 * 오른쪽에서 열리는 하나의 패널.
 *
 * 예전에는 화면 아래에 붙은 독이었다. 세로로 흐르는 대화가 세로 공간을 본문과
 * 나눠 먹어서, 열면 본문이 절반으로 눌리고 닫으면 대화가 안 보였다.
 *
 * 그래서 **덮어서** 연다. 닫혀 있을 때 폭은 0 이다 — 접힌 레일조차 두지 않는다.
 * 스레드 하나 때문에 모든 화면이 좁아질 이유가 없다. 여는 곳은 오른쪽 아래의 둥근 유리 단추(PanelDock) ·
 * 단축키(⌥⇧C · ⌘⇧F, 설정에서 바꾼다) · ?taskId= 링크다(2026-10-29, 제목줄의 「채팅 열기」 는 지웠다).
 *
 * 속은 폰 채팅 탭 그대로다(2026-11-11 작업지시자) — 방 목록 → 방 → 대화(PanelMessenger). 예전 「전체」(전사 채팅) ·
 * 「옴니스」(옴니스 1:1 드롭다운) 탭은 목록의 방 하나씩이 됐다. 업무 상세에서 열면 「이 업무」 스레드 탭이 앞에 하나 더 있다.
 * nav 「채팅」 으로 채팅 화면에 들어가면 패널은 닫히고, 패널에서 마지막으로 보던 방이 본문에 열린다(floating-nav · lib/panel-chat-rules.ts).
 *
 * md 미만에서는 열지 않는다(2026-11-04 작업지시자) — 화면 전체를 가려 채팅 탭으로 가는 편이 낫다. 단축키는 /chat 으로,
 * ?taskId= 는 그 업무방으로 보낸다. 저장된 「열림」 값이 있어도 그리지 않는다(내용을 만들지 않아 폴링도 돌지 않는다).
 */
export function RightPanel({ currentUserId }: Props) {
  const { open: panelOpen, setOpen, task, requestedView, clearRequestedView, omnisStartKey, clearOmnisStart } = useRightPanel()
  const isDesktop = useMediaQuery(NAV_DESKTOP_QUERY)
  const open = panelOpen && isDesktop
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const urlTaskId = searchParams.get("taskId")

  const [view, setView] = useState<PanelView>("chat")

  // 채팅 화면으로 들어오면 패널을 닫는다 — 본문이 이미 메신저다. 채팅 안에서 단축키로 다시 연 패널은 그대로 둔다
  const prevPath = useRef<string | null>(null)
  useEffect(() => {
    if (closesPanelOn(prevPath.current, pathname) && panelOpen) setOpen(false)
    prevPath.current = pathname
  }, [pathname, panelOpen, setOpen])

  // ⌘⇧F (윈도우는 Ctrl+Shift+F, 설정에서 바꿀 수 있다) — 어디서든 패널을 열고 전사방의 검색 줄로 간다. 이미 열려 있으면 검색칸을 다시 고른다.
  // 입력칸 안에서도 받는다 — 글을 쓰다가 바로 찾는 게 단축키의 쓸모다
  const [searchRequest, setSearchRequest] = useState(0)
  useShortcut("panelSearch", () => {
    if (!window.matchMedia(NAV_DESKTOP_QUERY).matches) {
      router.push("/chat")
      return
    }
    setOpen(true)
    setView("chat")
    setSearchRequest((n) => n + 1)
  })

  // 업무 화면으로 들어오면 그 업무 스레드로, 떠나면 채팅으로 되돌린다
  useEffect(() => {
    setView(task ? "task" : "chat")
  }, [task])

  // 밖에서 탭을 지정해 열었으면 그쪽을 보여 준다. 한 번 쓰고 지운다 —
  // 남겨 두면 다음에 그냥 열었을 때도 그 탭으로 끌려간다.
  useEffect(() => {
    if (!requestedView) return
    setView(requestedView === "task" && !task ? "chat" : requestedView)
    clearRequestedView()
  }, [requestedView, clearRequestedView, task])

  // 업무에서 「Omnis 와 함께 시작하기」 — 채팅으로 가서 새 옴니스 대화를 연다
  useEffect(() => {
    if (omnisStartKey) setView("chat")
  }, [omnisStartKey])

  // ?taskId= 로 들어온 딥링크는 패널을 열고 그 업무방을 보여 준다.
  //
  // "지금 taskId 가 있고 닫혀 있으면 연다" 로 두면 안 된다 — 방을 연 상태에서
  // 닫기를 누르는 순간 taskId 는 그대로라 즉시 다시 열려서, 아예 닫히지 않는다.
  // 그래서 taskId 가 **바뀐 순간**에만 연다.
  const openedFor = useRef<string | null>(null)
  const [openRequest, setOpenRequest] = useState<{ seq: number; room: PanelRoomRef } | null>(null)
  useEffect(() => {
    if (!urlTaskId) {
      openedFor.current = null
      return
    }
    if (openedFor.current === urlTaskId) return
    openedFor.current = urlTaskId
    // 하이드레이션 첫 값은 false 라 isDesktop 을 믿지 않고 직접 묻는다 — PC 링크가 업무방으로 튀면 안 된다
    if (!window.matchMedia(NAV_DESKTOP_QUERY).matches) {
      router.replace(`/chat/task/${encodeURIComponent(urlTaskId)}`)
      return
    }
    setOpen(true)
    if (task?.id === urlTaskId) {
      setView("task")
      return
    }
    setView("chat")
    setOpenRequest((r) => ({ seq: (r?.seq ?? 0) + 1, room: { id: urlTaskId, key: `task:${urlTaskId}`, kind: "TASK", name: "" } }))
  }, [urlTaskId, setOpen, router, task?.id])

  const tabs = useMemo(() => {
    if (!task) return []
    return [
      { key: "task" as const, label: "이 업무", hint: task.name },
      { key: "chat" as const, label: "채팅", hint: "채팅방 목록 — 전사방 · 옴니스 · 사람 · 업무방" },
    ]
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
        data-right-panel
        aria-hidden={!open}
        aria-label="대화 패널"
        className={cn(
          "glass fixed! top-[calc(var(--demo-banner-height,0px)+8px)] right-2 h-[calc(var(--app-vh)-var(--demo-banner-height,0px)-8px-0.5rem)] z-[var(--z-banner)] flex flex-col overflow-hidden rounded-[22px] transition-[transform,opacity] duration-200 motion-reduce:transition-none max-md:hidden",
          // 92vw 를 그대로 쓰면 안 된다 — vw 는 zoom 을 모르므로 배율만큼 화면을 넘친다
          // (--app-vh 주석과 같은 함정). zoom 을 나눈 --app-vw 로 계산한다.
          "w-[min(400px,calc(var(--app-vw)-16px))]",
          open ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-[calc(100%+16px)] opacity-0"
        )}
      >
        <div className="flex shrink-0 items-center gap-1.5 px-2.5 pt-2.5 pb-2">
          {tabs.length > 0 ? (
            // 탭은 nav 처럼 캡슐 하나 + 현재 탭만 한 겹 더 진한 유리(.glass-pill)
            <div role="group" aria-label="패널 보기" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded-full bg-muted/60 p-1 [scrollbar-width:none]">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setView(t.key)}
                  aria-pressed={view === t.key}
                  title={t.hint}
                  className={cn(
                    "touch-target inline-flex h-7 min-w-0 shrink-0 items-center justify-center gap-1 rounded-full px-3 text-[12px] whitespace-nowrap transition-[color,transform] duration-150 active:scale-[0.96] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    view === t.key ? "glass-pill bg-background font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t.key === "task" ? <span className="max-w-[7.5rem] truncate">{t.label}</span> : t.label}
                </button>
              ))}
            </div>
          ) : (
            <h2 className="min-w-0 flex-1 truncate px-2 text-[15px] font-semibold">채팅</h2>
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
        {/* 지금 보는 범위 — 이 업무 스레드 */}
        {view === "task" && task && (
          <p className="shrink-0 truncate px-4 pb-1.5 text-[11.5px] text-muted-foreground">
            <span className="mr-0.5 opacity-60">#</span>
            {task.name} 스레드
          </p>
        )}

        {/* 열려 있을 때만 내용을 만든다 — 닫힌 패널이 폴링할 이유가 없다 */}
        {open && (
          // pb-safe: 안드로이드 제스처바·홈 인디케이터에 입력창이 가리지 않게
          <div className="pb-safe mx-1.5 mb-1.5 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[18px] border bg-background">
            {view === "task" && task ? (
              <TaskThread taskId={task.id} taskName={task.name} messages={task.messages} currentUserId={currentUserId} />
            ) : (
              <PanelMessenger
                userId={currentUserId}
                startKey={omnisStartKey}
                onStarted={clearOmnisStart}
                openRequest={openRequest}
                searchRequest={searchRequest}
              />
            )}
          </div>
        )}
      </aside>
    </>
  )
}
