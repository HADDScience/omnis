"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { HugeiconsIcon } from "@hugeicons/react"
import { AiMagicIcon } from "@hugeicons/core-free-icons"
import { ThreadComposer } from "@/components/chat/thread-composer"

interface Message {
  id: string
  content: string
  createdAt: string
  author: { id: string; name: string }
  isTaskInstruction: boolean
  kind?: string
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

export function TaskSidebar({ taskId, messages }: TaskSidebarProps) {
  const systemMessages = messages.filter(
    (m) => m.kind === "TASK_REBUILT" || m.kind === "TASK_DONE" || m.kind === "TASK_CREATED"
  )
  const threadMessages = messages.filter((m) => m.kind !== "TASK_REBUILT")

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l bg-card">
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
          <div className="flex-1 overflow-auto p-3">
            <div className="flex flex-col gap-3">
              {threadMessages.length === 0 && (
                <div className="rounded-md border border-dashed p-4 text-center text-[11px] text-muted-foreground">
                  스레드 메시지 없음 · 아래 입력창에 답장하세요.
                </div>
              )}
              {threadMessages.map((m) => (
                <div key={m.id} className="flex items-start gap-2">
                  <Avatar className="h-6 w-6 shrink-0">
                    <AvatarFallback className="text-[9px]">
                      {m.author.name.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-[11.5px] font-semibold">{m.author.name}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {formatTime(m.createdAt)}
                      </span>
                    </div>
                    <div className="mt-0.5 whitespace-pre-wrap text-[12px] leading-[1.5]">
                      {m.content}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* #10: Composer 내장 (규칙 18 — List는 Composer 동반 필수) */}
          <ThreadComposer taskId={taskId} />
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
                          : "생성"}
                    </Badge>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {formatTime(m.createdAt)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11.5px] leading-[1.5]">{m.content}</div>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </aside>
  )
}
