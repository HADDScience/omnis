"use client"

import { useState, useMemo } from "react"
import { startOfWeek, startOfMonth } from "date-fns"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { DashboardMembers } from "./dashboard-members"
import { DashboardLists } from "./dashboard-lists"
import { DashboardWorkspace } from "./dashboard-workspace"
import type {
  WorkspaceProduct,
  WorkspaceCategory,
  WorkspaceTaskItem,
  WorkspaceProject,
} from "@/lib/workspace-types"

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

interface ProgressTask {
  id: string
  status: string
  updatedAt: string
}

type PeriodKey = "week" | "month" | "all"

interface DashboardViewProps {
  completionRate: number
  tasksForProgress: ProgressTask[]
  userStats: MemberStat[]
  gajumMarkdown: string
  gwajaeMarkdown: string
  workspaceProducts: WorkspaceProduct[]
  workspaceCategories: WorkspaceCategory[]
  workspaceProjects: WorkspaceProject[]
  workspaceTasks: WorkspaceTaskItem[]
}

const PERIOD_LABELS: Record<PeriodKey, string> = {
  week: "이번 주",
  month: "이번 달",
  all: "전체",
}

export function DashboardView({
  completionRate,
  tasksForProgress,
  userStats,
  gajumMarkdown,
  gwajaeMarkdown,
  workspaceProducts,
  workspaceCategories,
  workspaceProjects,
  workspaceTasks,
}: DashboardViewProps) {
  const [period, setPeriod] = useState<PeriodKey>("week")

  const periodStats = useMemo(() => {
    const now = new Date()
    const weekStart = startOfWeek(now, { weekStartsOn: 1 })
    const monthStart = startOfMonth(now)

    const cutoff = period === "week" ? weekStart : period === "month" ? monthStart : null
    const filtered = cutoff
      ? tasksForProgress.filter((t) => new Date(t.updatedAt) >= cutoff)
      : tasksForProgress

    const total = filtered.length
    const done = filtered.filter((t) => t.status === "DONE").length
    const inProgress = filtered.filter((t) => t.status === "IN_PROGRESS").length
    const todo = filtered.filter((t) => t.status === "TODO").length
    const rate = total > 0 ? Math.round((done / total) * 100) : 0

    return { total, done, inProgress, todo, rate }
  }, [period, tasksForProgress])

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      {/* 업무 진행률 */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">업무 진행률</CardTitle>
            <div className="flex items-center gap-1 rounded-md border p-0.5">
              {(Object.keys(PERIOD_LABELS) as PeriodKey[]).map((key) => (
                <button
                  key={key}
                  onClick={() => setPeriod(key)}
                  className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition-colors ${
                    period === key
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {PERIOD_LABELS[key]}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <Progress value={periodStats.rate} className="flex-1" />
            <span className="text-sm font-medium">{periodStats.rate}%</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>전체 {periodStats.total}건</span>
            <span>완료 {periodStats.done}</span>
            <span>진행 {periodStats.inProgress}</span>
            <span>대기 {periodStats.todo}</span>
          </div>
        </CardContent>
      </Card>

      {/* 워크스페이스 */}
      <DashboardWorkspace
        products={workspaceProducts}
        categories={workspaceCategories}
        projects={workspaceProjects}
        tasks={workspaceTasks}
      />

      {/* 팀원별 현황 */}
      {userStats.length > 0 && <DashboardMembers members={userStats} />}

      {/* 가점항목 / 과제 리스트 */}
      {(gajumMarkdown || gwajaeMarkdown) && (
        <DashboardLists gajumMarkdown={gajumMarkdown} gwajaeMarkdown={gwajaeMarkdown} />
      )}
    </div>
  )
}
