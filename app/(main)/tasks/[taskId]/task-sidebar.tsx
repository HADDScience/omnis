"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { HugeiconsIcon } from "@hugeicons/react"
import { AiMagicIcon } from "@hugeicons/core-free-icons"
import { ThreadComposer, type ThreadRefs } from "@/components/chat/thread-composer"
import { MESSAGE_ENTER, MessageContent, MessageFiles, type FileInfo } from "@/components/chat/message-list"
import { Spinner } from "@/components/ui/spinner"
import {
  AuthorAvatar,
  DayDivider,
  EventRow,
  MessageTime,
  eventSummary,
  isChatEventKind,
  type ChatEventKind,
} from "@/components/chat/message-parts"
import { layoutMessages, tidyBody } from "@/lib/chat-layout"
import { apiUrl } from "@/lib/base-path"

interface Message {
  id: string
  content: string
  createdAt: string
  author: { id: string; name: string }
  isTaskInstruction: boolean
  kind?: string
  files?: FileInfo[]
}

interface TaskSidebarProps {
  taskId: string
  taskName: string
  messages: Message[]
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

/** TASK_CREATED 메시지는 `__TASK_CREATED__:<id>` sentinel이므로 사람이 읽을 라벨로 치환 */
function isCreatedSentinel(m: Message): boolean {
  return m.kind === "TASK_CREATED" || m.content.startsWith("__TASK_CREATED__:")
}

function displayContent(m: Message): string {
  return isCreatedSentinel(m) ? "업무가 생성되었습니다" : m.content
}

/** 스레드에 사건 줄로 그릴 메시지의 종류. 사람 메시지면 null — 🤖 로 시작하는 시스템 글(보류 · 재개 · 실패)도 사건이다 */
function eventKindOf(m: Message): ChatEventKind | null {
  if (isChatEventKind(m.kind)) return m.kind
  if (isCreatedSentinel(m)) return "TASK_CREATED"
  if (m.content.startsWith("🤖")) return "TASK_REBUILT"
  return null
}

/**
 * 멘션 자동완성 · 링크에 쓰는 업무 · 사람 · 최근 파일. 채팅 패널과 같은 API 를 한 번만 부른다.
 * 실패해도 스레드는 그대로 쓸 수 있다 — 자동완성과 #링크만 빠진다.
 */
function useThreadRefs(): ThreadRefs {
  const [refs, setRefs] = useState<ThreadRefs>({ tasks: [], users: [], files: [] })
  useEffect(() => {
    let alive = true
    const get = (path: string) => fetch(apiUrl(path)).then((r) => (r.ok ? r.json() : [])).catch(() => [])
    void Promise.all([get("/api/tasks"), get("/api/users"), get("/api/files")]).then(([tasks, users, files]) => {
      if (!alive) return
      setRefs({
        tasks: (tasks as { id: string; name: string; slug: string; status: string }[]).map((t) => ({
          id: t.id,
          name: t.name,
          slug: t.slug,
          status: t.status,
        })),
        users,
        files,
      })
    })
    return () => {
      alive = false
    }
  }, [])
  return refs
}

export function TaskThread({ taskId, messages }: TaskSidebarProps) {
  const refs = useThreadRefs()
  const slug = refs.tasks.find((t) => t.id === taskId)?.slug
  const systemMessages = messages.filter(
    (m) =>
      m.kind === "TASK_REBUILT" ||
      m.kind === "TASK_DONE" ||
      m.kind === "TASK_DONE_PENDING" ||
      m.kind === "TASK_CREATED"
  )
  // 재구성 결과도 스레드에 사건 줄로 남긴다 — 응답 뒤에 끝나므로 끝났다는 표시가 스레드에 있어야 한다
  const threadMessages = messages
  const rows = layoutMessages(threadMessages.map((m) => ({ ...m, isEvent: eventKindOf(m) !== null })))
  const router = useRouter()

  // AI 재구성은 응답 뒤에 돈다. 끝날 때까지 「갱신 중」 한 줄을 두고 2초마다 묻는다 — 입력창은 막지 않는다
  const [rebuildWait, setRebuildWait] = useState<string | null>(null)
  useEffect(() => {
    if (!rebuildWait) return
    let alive = true
    const startedAt = Date.now()
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      const res = await fetch(apiUrl(`/api/tasks/${taskId}/rebuild-status?messageId=${rebuildWait}`)).catch(() => null)
      const data = res?.ok ? ((await res.json().catch(() => null)) as { done?: boolean } | null) : null
      if (!alive) return
      // 90초가 지나도 끝을 못 들으면 거둔다 — 결과는 새로고침으로 들어온다
      if (data?.done || Date.now() - startedAt > 90_000) {
        setRebuildWait(null)
        router.refresh()
        return
      }
      timer = setTimeout(tick, 2000)
    }
    timer = setTimeout(tick, 1500)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [rebuildWait, taskId, router])

  // 보내기 누른 글을 서버 응답(AI 재구성까지 8~13초) 전에 바로 보여 준다.
  // 목록 길이를 같이 적어 두고, 새 메시지가 붙어 길이가 바뀌면 저절로 사라진다.
  const [pending, setPending] = useState<{ content: string; count: number } | null>(null)
  const showPending = pending && pending.count === threadMessages.length ? pending : null
  // 이 시각 뒤에 생긴 메시지만 떠오르게 한다
  const [mountedAt] = useState(() => Date.now())

  // 채팅처럼 최신 메시지가 보이게 — 열 때와 새 메시지가 붙을 때 맨 아래로 내린다
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [threadMessages.length, showPending, rebuildWait])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Tabs defaultValue="thread" className="flex h-full flex-col">
        {/* #9: "결과" 탭 제거 — task-detail에 동일 체크리스트 존재 (중복 제거) */}
        <TabsList className="grid h-10 w-full shrink-0 grid-cols-2 rounded-none border-b bg-transparent p-0">
          <TabsTrigger
            value="thread"
            className="rounded-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none"
          >
            스레드
          </TabsTrigger>
          <TabsTrigger
            value="history"
            className="rounded-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none"
          >
            히스토리
          </TabsTrigger>
        </TabsList>

        <TabsContent value="thread" className="mt-0 flex min-h-0 flex-1 flex-col p-0">
          <div ref={listRef} className="flex-1 overflow-auto p-3">
            <div role="log" aria-label="업무 스레드" className="flex flex-col">
              {threadMessages.length === 0 && (
                <div className="rounded-md border border-dashed p-4 text-center text-[11px] text-muted-foreground">
                  스레드 메시지 없음 · 아래 입력창에 답장하세요. 파일은 붙여넣거나 끌어다 놓으면 됩니다.
                </div>
              )}
              {rows.map((row) => {
                if (row.type === "day") return <DayDivider key={row.key} label={row.label} />
                const m = row.message
                const kind = eventKindOf(m)
                if (kind) {
                  const fresh = new Date(m.createdAt).getTime() > mountedAt
                  return (
                    <div key={row.key} className={fresh ? MESSAGE_ENTER : undefined}>
                      <EventRow kind={kind} iso={m.createdAt}>
                        {kind === "TASK_CREATED" ? (
                          <>
                            <span className="font-medium text-foreground/80">{m.author.name}</span> 님이 업무를 만들었습니다
                          </>
                        ) : (
                          <>
                            <span className="font-medium text-foreground/80">옴니스</span> {eventSummary(kind, m.content)}
                          </>
                        )}
                      </EventRow>
                    </div>
                  )
                }
                return (
                  <div
                    key={row.key}
                    className={`group/msg relative -mx-3 flex gap-2.5 px-3 hover:bg-muted/40 ${row.groupStart ? "mt-2.5 pt-1" : ""} ${row.groupEnd ? "pb-1" : ""} ${
                      new Date(m.createdAt).getTime() > mountedAt ? MESSAGE_ENTER : ""
                    }`}
                  >
                    {row.groupStart ? (
                      <AuthorAvatar name={m.author.name} className="mt-0.5" />
                    ) : (
                      // 묶음 안 줄은 아바타 자리에 hover 로 시간만 — 폭은 아바타와 같게 두고 글자는 띄워 본문 줄이 어긋나지 않게
                      <span className="relative w-[28px] shrink-0">
                        <MessageTime
                          iso={m.createdAt}
                          compact
                          className="absolute right-0 top-[3px] text-[10px] opacity-0 group-hover/msg:opacity-100"
                        />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      {row.groupStart && (
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-[13px] font-semibold">{m.author.name}</span>
                          <MessageTime iso={m.createdAt} />
                        </div>
                      )}
                      <div className="whitespace-pre-wrap break-keep text-[13px] leading-[1.6] [overflow-wrap:anywhere]">
                        <MessageContent content={tidyBody(m.content)} tasks={refs.tasks} />
                      </div>
                      {m.files && m.files.length > 0 && <MessageFiles files={m.files} />}
                    </div>
                  </div>
                )
              })}
              {showPending && (
                <div className={`-mx-3 mt-2.5 flex gap-2.5 px-3 pb-1 pt-1 ${MESSAGE_ENTER}`} aria-live="polite">
                  <span className="w-[28px] shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="whitespace-pre-wrap break-keep text-[13px] leading-[1.6] text-foreground/60 [overflow-wrap:anywhere]">
                      {tidyBody(showPending.content)}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Spinner className="h-3 w-3" />
                      보내는 중…
                    </div>
                  </div>
                </div>
              )}
              {rebuildWait && !showPending && (
                <div
                  role="status"
                  aria-live="polite"
                  className={`flex items-center gap-2 py-1.5 pl-9 text-[12px] text-muted-foreground ${MESSAGE_ENTER}`}
                >
                  <Spinner className="h-3.5 w-3.5 text-primary" />
                  <span className="break-keep">
                    <span className="font-medium text-foreground/80">옴니스</span>가 업무를 갱신하고 있어요
                    <span className="text-muted-foreground/80"> · 계속 입력하셔도 됩니다</span>
                  </span>
                </div>
              )}
            </div>
          </div>
          {/* #10: Composer 내장 (규칙 18 — List는 Composer 동반 필수). 채팅 입력창과 같은 기능 */}
          <ThreadComposer
            taskId={taskId}
            taskSlug={slug}
            tasks={refs.tasks}
            users={refs.users}
            files={refs.files}
            onPending={(content) => setPending(content ? { content, count: threadMessages.length } : null)}
            onQueued={setRebuildWait}
          />
        </TabsContent>

        <TabsContent value="history" className="mt-0 flex-1 overflow-auto p-3">
          <div className="flex flex-col gap-2.5">
            {systemMessages.length === 0 && (
              <div className="rounded-md border border-dashed p-4 text-center text-[11px] text-muted-foreground">
                재구성 이력 없음
              </div>
            )}
            {systemMessages.map((m) => (
              <div
                key={m.id}
                className="flex items-start gap-2 rounded-md border bg-muted/40 px-2.5 py-2"
              >
                <HugeiconsIcon
                  icon={AiMagicIcon}
                  size={13}
                  className="mt-0.5 shrink-0 text-primary"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    <Badge variant="secondary" className="h-4 px-1.5 text-[9px]">
                      {m.kind === "TASK_REBUILT"
                        ? "재구성"
                        : m.kind === "TASK_DONE"
                          ? "완료"
                          : m.kind === "TASK_DONE_PENDING"
                            ? "확인 대기"
                            : "생성"}
                    </Badge>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {formatTime(m.createdAt)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11.5px] leading-[1.5]">{displayContent(m)}</div>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
