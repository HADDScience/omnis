"use client"

import { useState, useCallback, useMemo } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { format, startOfWeek, endOfWeek } from "date-fns"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { HugeiconsIcon } from "@hugeicons/react"
import { CheckmarkCircle02Icon, Delete02Icon, NoteEditIcon } from "@hugeicons/core-free-icons"
import { TASK_STATUS_LABELS } from "@/lib/constants"

interface PersonalTask {
  id: string
  name: string
  slug: string
  status: string
  priority: string | null
  deadline: string | null
  updatedAt?: string
  createdAt?: string
}

interface DashboardPersonalProps {
  currentUserId: string
  tasks: PersonalTask[]
}

function getDaysLeft(deadline: string | null): { label: string; color: string } | null {
  if (!deadline) return null
  const d = new Date(deadline)
  const now = new Date()
  const diffMs = d.getTime() - now.getTime()
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays < 0) return { label: `${Math.abs(diffDays)}일 초과`, color: "text-red-500" }
  if (diffDays === 0) return { label: "오늘 마감", color: "text-yellow-600" }
  if (diffDays <= 3) return { label: `D-${diffDays}`, color: "text-yellow-500" }
  if (diffDays <= 7) return { label: `D-${diffDays}`, color: "text-muted-foreground" }
  return { label: `D-${diffDays}`, color: "text-muted-foreground" }
}

function isDelayed(task: PersonalTask): boolean {
  if (!task.deadline) return false
  return new Date(task.deadline) < new Date() && task.status !== "DONE"
}

const BOARD_COLUMNS = [
  { key: "TODO", label: "할 일", color: "text-yellow-500", filter: (t: PersonalTask) => t.status === "TODO" },
  { key: "IN_PROGRESS", label: "진행 중", color: "text-green-500", filter: (t: PersonalTask) => t.status === "IN_PROGRESS" },
  { key: "REVIEW", label: "리뷰", color: "text-orange-500", filter: (t: PersonalTask) => t.status === "REVIEW" },
  { key: "DONE", label: "완료", color: "text-muted-foreground", filter: (t: PersonalTask) => t.status === "DONE" },
] as const

function BoardCard({ task, onComplete, onArchive }: {
  task: PersonalTask
  onComplete: (id: string) => void
  onArchive: (id: string) => void
}) {
  const delayed = isDelayed(task)
  const daysLeft = getDaysLeft(task.deadline)
  const isDone = task.status === "DONE"

  return (
    <div
      className={`group flex items-start gap-1.5 rounded-lg border p-2 transition-colors hover:bg-muted/50 ${
        delayed ? "border-red-500/30 bg-red-500/5" : ""
      }`}
    >
      <Link href={`/tasks/${task.id}`} className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`text-[11px] font-medium leading-snug line-clamp-1 ${isDone ? "line-through text-muted-foreground" : ""}`}>
            {task.name}
          </span>
          {daysLeft && !isDone && (
            <span className={`shrink-0 text-[9px] font-medium ${daysLeft.color}`}>
              {daysLeft.label}
            </span>
          )}
        </div>
      </Link>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {!isDone && (
          <button
            onClick={(e) => { e.preventDefault(); onComplete(task.id) }}
            className="rounded p-0.5 text-green-500 hover:bg-green-500/10 transition-colors"
            title="완료 처리"
          >
            <HugeiconsIcon icon={CheckmarkCircle02Icon} size={14} />
          </button>
        )}
        <button
          onClick={(e) => { e.preventDefault(); onArchive(task.id) }}
          className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
          title="삭제"
        >
          <HugeiconsIcon icon={Delete02Icon} size={14} />
        </button>
      </div>
    </div>
  )
}

export function DashboardPersonal({ currentUserId, tasks }: DashboardPersonalProps) {
  const router = useRouter()
  const myTasks = tasks
  const doneCount = myTasks.filter((t) => t.status === "DONE").length
  const totalCount = myTasks.length
  const completionRate = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0

  // 업무 보고서 날짜 범위
  const now = new Date()
  const [rangeStart, setRangeStart] = useState(format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"))
  const [rangeEnd, setRangeEnd] = useState(format(endOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"))
  const [showReport, setShowReport] = useState(false)

  const reportTasks = useMemo(() => {
    const start = new Date(rangeStart)
    const end = new Date(rangeEnd + "T23:59:59")
    return myTasks.filter((t) => {
      const updated = t.updatedAt ? new Date(t.updatedAt) : null
      const created = t.createdAt ? new Date(t.createdAt) : null
      return (updated && updated >= start && updated <= end) || (created && created >= start && created <= end)
    })
  }, [myTasks, rangeStart, rangeEnd])

  const reportCompleted = reportTasks.filter((t) => t.status === "DONE")
  const reportInProgress = reportTasks.filter((t) => t.status === "IN_PROGRESS")
  const reportTodo = reportTasks.filter((t) => t.status === "TODO")
  const reportDelayed = reportTasks.filter((t) => isDelayed(t) && t.status !== "DONE")

  const handleComplete = useCallback(async (taskId: string) => {
    await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "DONE" }),
    })
    router.refresh()
  }, [router])

  const handleArchive = useCallback(async (taskId: string) => {
    if (!confirm("이 업무를 삭제하시겠습니까?")) return
    await fetch(`/api/tasks/${taskId}`, { method: "DELETE" })
    router.refresh()
  }, [router])

  return (
    <div className="flex flex-col gap-4">
      {/* 진행률 바 */}
      <div className="flex items-center gap-3 rounded-lg border p-3">
        <span className="text-sm font-medium">내 업무</span>
        <Progress value={completionRate} className="flex-1" />
        <span className="text-sm font-medium">{completionRate}%</span>
        <span className="text-xs text-muted-foreground">
          ({doneCount}/{totalCount})
        </span>
      </div>

      {/* 업무 보고서 날짜 범위 */}
      <div className="flex items-center gap-2 flex-wrap">
        <Input
          type="date"
          value={rangeStart}
          onChange={(e) => setRangeStart(e.target.value)}
          className="h-8 w-36 text-xs"
        />
        <span className="text-xs text-muted-foreground">~</span>
        <Input
          type="date"
          value={rangeEnd}
          onChange={(e) => setRangeEnd(e.target.value)}
          className="h-8 w-36 text-xs"
        />
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() => setShowReport(true)}
        >
          <HugeiconsIcon icon={NoteEditIcon} size={14} />
          업무 보고서
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-1">{reportTasks.length}</Badge>
        </Button>
      </div>

      {/* 보드 */}
      <div className="grid grid-cols-4 gap-3">
        {BOARD_COLUMNS.map((col) => {
          const columnTasks = myTasks.filter(col.filter)
          const limited = col.key === "DONE" ? columnTasks.slice(0, 8) : columnTasks

          return (
            <div key={col.key} className="flex flex-col gap-2">
              <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
                <span className={`text-xs font-semibold ${col.color}`}>
                  {col.label}
                </span>
                <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0">
                  {columnTasks.length}
                </Badge>
              </div>

              <div className="flex flex-col gap-1.5">
                {limited.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-3 text-center text-[10px] text-muted-foreground">
                    없음
                  </div>
                ) : (
                  limited.map((t) => (
                    <BoardCard
                      key={t.id}
                      task={t}
                      onComplete={handleComplete}
                      onArchive={handleArchive}
                    />
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* 업무 보고서 모달 */}
      <Dialog open={showReport} onOpenChange={setShowReport}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">
              업무 보고서
            </DialogTitle>
            <p className="text-xs text-muted-foreground">
              {rangeStart} ~ {rangeEnd}
            </p>
          </DialogHeader>

          <div className="flex flex-col gap-4 text-sm">
            {/* 요약 */}
            <div className="flex items-center gap-4 rounded-lg bg-muted/50 p-3 text-xs">
              <span>전체 <strong>{reportTasks.length}</strong></span>
              <span>완료 <strong className="text-green-600">{reportCompleted.length}</strong></span>
              <span>진행 <strong className="text-blue-600">{reportInProgress.length}</strong></span>
              <span>대기 <strong>{reportTodo.length}</strong></span>
              {reportDelayed.length > 0 && (
                <span>지연 <strong className="text-red-500">{reportDelayed.length}</strong></span>
              )}
            </div>

            {/* 완료 업무 */}
            {reportCompleted.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-green-600 mb-1.5">완료 업무</h3>
                <ul className="flex flex-col gap-1">
                  {reportCompleted.map((t) => (
                    <li key={t.id} className="flex items-center gap-2 text-sm">
                      <span className="text-green-500">✓</span>
                      <span>{t.name}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 진행 중 업무 */}
            {reportInProgress.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-blue-600 mb-1.5">진행 중 업무</h3>
                <ul className="flex flex-col gap-1">
                  {reportInProgress.map((t) => (
                    <li key={t.id} className="flex items-center gap-2 text-sm">
                      <span className="text-blue-500">●</span>
                      <span>{t.name}</span>
                      {t.deadline && (
                        <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                          마감 {format(new Date(t.deadline), "MM/dd")}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 대기 업무 */}
            {reportTodo.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground mb-1.5">예정 업무</h3>
                <ul className="flex flex-col gap-1">
                  {reportTodo.map((t) => (
                    <li key={t.id} className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">○</span>
                      <span>{t.name}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 지연 업무 */}
            {reportDelayed.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-red-500 mb-1.5">지연 업무</h3>
                <ul className="flex flex-col gap-1">
                  {reportDelayed.map((t) => (
                    <li key={t.id} className="flex items-center gap-2 text-sm">
                      <span className="text-red-500">!</span>
                      <span>{t.name}</span>
                      {t.deadline && (
                        <span className="text-[10px] text-red-400 ml-auto shrink-0">
                          {getDaysLeft(t.deadline)?.label}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {reportTasks.length === 0 && (
              <p className="text-center text-muted-foreground py-4">
                해당 기간에 업무가 없습니다.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
