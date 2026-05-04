"use client"

import { useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { TASK_STATUS_LABELS, TASK_STATUS_COLORS } from "@/lib/constants"

interface TaskItem {
  id: string
  name: string
  status: string
}

interface MemberStat {
  id: string
  name: string
  total: number
  inProgress: number
  done: number
  todo: number
  recent: (TaskItem & { updatedAt: string })[]
  tasksByStatus: {
    IN_PROGRESS: TaskItem[]
    DONE: TaskItem[]
    TODO: TaskItem[]
  }
}

type TabKey = "recent" | "IN_PROGRESS" | "DONE" | "TODO"

const TABS: { key: TabKey; label: string; color: string }[] = [
  { key: "recent", label: "최근활동", color: "" },
  { key: "IN_PROGRESS", label: "진행", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
  { key: "DONE", label: "완료", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  { key: "TODO", label: "대기", color: "" },
]

export function DashboardMembers({ members }: { members: MemberStat[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">팀원별 현황</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {members.map((m) => (
            <MemberCard key={m.id} member={m} />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function MemberCard({ member }: { member: MemberStat }) {
  const [activeTab, setActiveTab] = useState<TabKey>("recent")

  const tasks: TaskItem[] =
    activeTab === "recent"
      ? member.recent
      : member.tasksByStatus[activeTab as "IN_PROGRESS" | "DONE" | "TODO"] || []

  const counts: Record<string, number> = {
    IN_PROGRESS: member.inProgress,
    DONE: member.done,
    TODO: member.todo,
  }

  return (
    <div className="flex flex-col rounded-lg border">
      {/* 헤더 */}
      <div className="flex items-center gap-3 p-3 border-b">
        <Avatar className="h-9 w-9">
          <AvatarFallback className="text-sm">{member.name.charAt(0)}</AvatarFallback>
        </Avatar>
        <div>
          <div className="text-sm font-medium">{member.name}</div>
          <div className="text-[10px] text-muted-foreground">{member.total}건</div>
        </div>
      </div>

      {/* 탭 뱃지 */}
      <div className="flex items-center gap-1 px-3 py-2 border-b flex-wrap">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key
          const count = tab.key === "recent" ? null : counts[tab.key]
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] transition-colors ${
                isActive
                  ? tab.color || "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {tab.label}
              {count !== null && <span>{count}</span>}
            </button>
          )
        })}
      </div>

      {/* 업무 목록 */}
      <ScrollArea className="h-[160px]">
        <div className="flex flex-col">
          {tasks.length === 0 ? (
            <div className="p-3 text-center text-[11px] text-muted-foreground">
              해당 업무가 없습니다
            </div>
          ) : (
            tasks.map((t) => (
              <Link
                key={t.id}
                href={`/tasks/${t.id}`}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted transition-colors"
              >
                <Badge
                  variant="secondary"
                  className={`shrink-0 text-[9px] px-1.5 py-0 ${TASK_STATUS_COLORS[t.status] ?? ""}`}
                >
                  {TASK_STATUS_LABELS[t.status]?.slice(0, 2) ?? t.status}
                </Badge>
                <span className="text-xs truncate">{t.name}</span>
              </Link>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
