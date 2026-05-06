"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { useDraggable, useDroppable } from "@dnd-kit/core"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"

type Status = "TODO" | "IN_PROGRESS" | "REVIEW" | "DONE"

const COLUMNS: { key: Status; label: string; color: string }[] = [
  { key: "TODO", label: "할 일", color: "oklch(0.708 0 0)" },
  { key: "IN_PROGRESS", label: "진행 중", color: "var(--primary)" },
  { key: "REVIEW", label: "리뷰", color: "var(--color-warn)" },
  { key: "DONE", label: "완료", color: "var(--color-success)" },
]

export interface KanbanTask {
  id: string
  slug: string
  name: string
  status: Status
  ownerName: string | null
  projectName: string | null
  /** 1-hop project.product (CLAUDE.md 규칙 21) */
  productName: string | null
  productColor: string | null
  deadline: string | null
}

const PROJECT_COLOR_PALETTE = [
  "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300",
  "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
  "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
  "border-purple-300 bg-purple-50 text-purple-700 dark:border-purple-500/30 dark:bg-purple-500/10 dark:text-purple-300",
  "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300",
  "border-cyan-300 bg-cyan-50 text-cyan-800 dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:text-cyan-300",
  "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300",
  "border-teal-300 bg-teal-50 text-teal-800 dark:border-teal-500/30 dark:bg-teal-500/10 dark:text-teal-300",
]

function projectColorClass(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return PROJECT_COLOR_PALETTE[Math.abs(hash) % PROJECT_COLOR_PALETTE.length]
}

function formatDeadline(deadline: string, isDone: boolean) {
  const target = new Date(deadline)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate())
  const diffDays = Math.round((targetDay.getTime() - today.getTime()) / 86400000)

  if (!isDone && diffDays < 0) {
    return {
      text: `D+${Math.abs(diffDays)}`,
      className: "text-destructive font-medium",
      overdue: true,
    }
  }
  if (diffDays === 0) {
    return { text: "오늘", className: "text-orange-500 font-semibold", overdue: false }
  }
  if (diffDays <= 7) {
    return { text: `D-${diffDays}`, className: "text-foreground font-medium", overdue: false }
  }
  return {
    text: target.toLocaleDateString("ko-KR", { month: "short", day: "numeric" }),
    className: "text-muted-foreground",
    overdue: false,
  }
}

function TaskCard({ task }: { task: KanbanTask }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { status: task.status },
  })
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined

  const deadlineInfo = task.deadline ? formatDeadline(task.deadline, task.status === "DONE") : null
  const overdue = deadlineInfo?.overdue ?? false

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={[
        "relative cursor-grab rounded-md border bg-card p-2.5 transition-shadow",
        isDragging ? "opacity-40 shadow-lg" : "hover:border-border-strong",
        overdue ? "ring-1 ring-destructive/30" : "",
      ].join(" ")}
    >
      {overdue && (
        <Badge
          variant="destructive"
          className="absolute right-2 top-2 h-4 px-1.5 text-[9px] leading-none"
        >
          지연
        </Badge>
      )}
      <Link
        href={`/tasks/${task.id}`}
        onClick={(e) => e.stopPropagation()}
        className={[
          "block text-[12.5px] font-medium leading-snug text-foreground",
          overdue ? "pr-10" : "",
        ].join(" ")}
      >
        {task.name}
      </Link>
      <div className="mt-1 truncate text-[10.5px] text-muted-foreground">#{task.slug}</div>
      <div className="mt-2 flex items-center gap-1.5">
        {task.ownerName && (
          <Avatar className="h-5 w-5 shrink-0">
            <AvatarFallback className="text-[9px]">{task.ownerName.charAt(0)}</AvatarFallback>
          </Avatar>
        )}
        {(task.productName || task.projectName) && (
          <span
            className={[
              "inline-flex h-4 max-w-[160px] items-center truncate rounded-full border px-1.5 text-[9px] font-medium leading-none",
              projectColorClass(task.productName ?? task.projectName ?? ""),
            ].join(" ")}
            title={[task.productName, task.projectName].filter(Boolean).join(" / ")}
          >
            {task.productName ? `${task.productName} / ` : ""}{task.projectName ?? "-"}
          </span>
        )}
        {deadlineInfo && (
          <span className={["ml-auto shrink-0 font-mono text-[10px]", deadlineInfo.className].join(" ")}>
            {deadlineInfo.text}
          </span>
        )}
      </div>
    </div>
  )
}

function KanbanColumn({
  status,
  label,
  color,
  tasks,
}: {
  status: Status
  label: string
  color: string
  tasks: KanbanTask[]
}) {
  const { isOver, setNodeRef } = useDroppable({ id: status, data: { status } })
  return (
    <div
      ref={setNodeRef}
      className={[
        "flex min-w-[260px] flex-1 flex-col rounded-lg border bg-muted/30 p-2.5 transition-colors",
        isOver ? "border-primary bg-primary/5" : "",
      ].join(" ")}
    >
      <div className="mb-2 flex items-center gap-1.5 px-1">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-[11.5px] font-semibold">{label}</span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          {tasks.length}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 overflow-auto">
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} />
        ))}
        {tasks.length === 0 && (
          <div className="rounded-md border border-dashed p-3 text-center text-[10.5px] text-muted-foreground">
            비어있음
          </div>
        )}
      </div>
    </div>
  )
}

interface TasksBoardProps {
  initialTasks: KanbanTask[]
}

export function TasksBoard({ initialTasks }: TasksBoardProps) {
  const [tasks, setTasks] = useState(initialTasks)
  const [dragging, setDragging] = useState<KanbanTask | null>(null)
  const router = useRouter()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const byStatus = useMemo(() => {
    const map = new Map<Status, KanbanTask[]>()
    for (const col of COLUMNS) map.set(col.key, [])
    for (const t of tasks) {
      const list = map.get(t.status) ?? []
      list.push(t)
      map.set(t.status, list)
    }
    return map
  }, [tasks])

  function onDragStart(e: DragStartEvent) {
    const t = tasks.find((x) => x.id === e.active.id)
    setDragging(t ?? null)
  }

  async function onDragEnd(e: DragEndEvent) {
    setDragging(null)
    const taskId = e.active.id as string
    const newStatus = e.over?.data.current?.status as Status | undefined
    if (!newStatus) return
    const task = tasks.find((t) => t.id === taskId)
    if (!task || task.status === newStatus) return

    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t)))

    const res = await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    })
    if (!res.ok) {
      toast.error("상태 변경 실패")
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: task.status } : t)))
    } else {
      router.refresh()
    }
  }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="flex h-full gap-2.5 overflow-auto p-4">
        {COLUMNS.map((c) => (
          <KanbanColumn
            key={c.key}
            status={c.key}
            label={c.label}
            color={c.color}
            tasks={byStatus.get(c.key) ?? []}
          />
        ))}
      </div>
      <DragOverlay>
        {dragging && (
          <div className="rotate-2 rounded-md border bg-card p-2.5 shadow-xl">
            <div className="text-[12.5px] font-medium">{dragging.name}</div>
            <div className="text-[10.5px] text-muted-foreground">#{dragging.slug}</div>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
