"use client"

import { useEffect, useRef, useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { HugeiconsIcon } from "@hugeicons/react"
import { AiMagicIcon } from "@hugeicons/core-free-icons"
import { ThreadComposer, type ThreadRefs } from "@/components/chat/thread-composer"
import { MessageContent, MessageFiles, type FileInfo } from "@/components/chat/message-list"
import { AuthorAvatar, DayDivider, EventRow, MessageTime, isChatEventKind } from "@/components/chat/message-parts"
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
  const threadMessages = messages.filter((m) => m.kind !== "TASK_REBUILT")
  const rows = layoutMessages(
    threadMessages.map((m) => ({ ...m, isEvent: isChatEventKind(m.kind) || isCreatedSentinel(m) })),
  )

  // 채팅처럼 최신 메시지가 보이게 — 열 때와 새 메시지가 붙을 때 맨 아래로 내린다
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [threadMessages.length])

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
                if (isChatEventKind(m.kind) || isCreatedSentinel(m)) {
                  const kind = isChatEventKind(m.kind) ? m.kind : "TASK_CREATED"
                  return (
                    <EventRow key={row.key} kind={kind} iso={m.createdAt}>
                      <span className="font-medium text-foreground/80">{m.author.name}</span>
                      {kind === "TASK_CREATED" ? " 님이 업무를 만들었습니다" : ` · ${m.content}`}
                    </EventRow>
                  )
                }
                return (
                  <div
                    key={row.key}
                    className={`group/msg relative -mx-3 flex gap-2.5 px-3 hover:bg-muted/40 ${row.groupStart ? "mt-2.5 pt-1" : ""} ${row.groupEnd ? "pb-1" : ""}`}
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
            </div>
          </div>
          {/* #10: Composer 내장 (규칙 18 — List는 Composer 동반 필수). 채팅 입력창과 같은 기능 */}
          <ThreadComposer taskId={taskId} taskSlug={slug} tasks={refs.tasks} users={refs.users} files={refs.files} />
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
