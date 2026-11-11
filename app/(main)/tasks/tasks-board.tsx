"use client"

import { UNASSIGNED_LABEL } from "@/lib/task-unassigned"
import { useMemo, useState, type SyntheticEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { useDraggable, useDroppable } from "@dnd-kit/core"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { apiUrl } from "@/lib/base-path"
import { QuickAssignChip } from "@/components/tasks/list-quick-assign"
import { AssigneeStack } from "@/components/tasks/assignee-stack"
import { StartWithOmnisIcon } from "@/components/tasks/start-with-omnis"

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
  /** 담당자 전체 — 겹친 아바타 · 담당 바꾸기 */
  owners?: { id: string; name: string }[]
  /** 미완료인데 담당자가 없다 — lib/task-unassigned.ts */
  unassigned?: boolean
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

type Person = { id: string; name: string }
type AssignFn = (task: { id: string; owners?: Person[] }, people: Person[]) => void

/**
 * 카드 안 단추(담당 지정 · Omnis 와 시작)와 그 단추가 띄운 창은 끌기를 시작하지 않는다.
 * 창(팝오버 · 바텀시트 · 확인)은 포털로 그려져도 React 이벤트는 이 카드까지 올라온다 — 카드 DOM 밖에서 왔거나
 * 단추 칸([data-no-drag]) 안에서 온 누름은 끌기 센서에 넘기지 않는다.
 */
function dragOnlyFromCard(listeners: ReturnType<typeof useDraggable>["listeners"]): Record<string, (e: SyntheticEvent) => void> | undefined {
  if (!listeners) return listeners
  const out: Record<string, (e: SyntheticEvent) => void> = {}
  for (const [name, fn] of Object.entries(listeners)) {
    out[name] = (e) => {
      const target = e.target as Element | null
      const card = e.currentTarget as Element
      if (!target || !card.contains(target) || target.closest("[data-no-drag]")) return
      ;(fn as (e: SyntheticEvent) => void)(e)
    }
  }
  return out
}

function TaskCard({ task, members, onAssign }: { task: KanbanTask; members?: Person[]; onAssign?: AssignFn }) {
  // 끌리는 모양은 DragOverlay 가 그린다. 원본까지 transform 으로 옮기면 overflow-auto 컬럼 안에서
  // 스크롤 영역이 늘었다 줄며 자동 스크롤이 튀었다 — 원본은 제자리에 흐리게만 남긴다.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { status: task.status },
  })

  const deadlineInfo = task.deadline ? formatDeadline(task.deadline, task.status === "DONE") : null
  const overdue = deadlineInfo?.overdue ?? false

  return (
    <div
      ref={setNodeRef}
      {...dragOnlyFromCard(listeners)}
      {...attributes}
      className={[
        "relative cursor-grab select-none rounded-md border bg-card p-2.5 transition-shadow [-webkit-touch-callout:none]",
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
        {/* 담당 단추 — 비었으면 「담당 지정」, 있으면 겹친 아바타. 눌러 여러 명을 넣고 뺀다(끌기와 겹치지 않게 data-no-drag) */}
        {members && onAssign ? (
          <span data-no-drag className="contents">
            <QuickAssignChip taskId={task.id} taskName={task.name} members={members} current={task.owners ?? []} onAssign={(p) => onAssign(task, p)} />
          </span>
        ) : task.unassigned ? (
          <Badge variant="outline" className="h-5 shrink-0 border-destructive/40 px-1.5 text-[10px] text-destructive">
            {UNASSIGNED_LABEL}
          </Badge>
        ) : task.owners && task.owners.length > 0 ? (
          <AssigneeStack people={task.owners} size="xs" />
        ) : task.ownerName ? (
          <Avatar className="h-5 w-5 shrink-0">
            <AvatarFallback className="text-[9px]">{task.ownerName.charAt(0)}</AvatarFallback>
          </Avatar>
        ) : null}
        {(task.productName || task.projectName) && (
          <span
            className={[
              // max-w-[160px] + truncate 는 화면 폭과 무관하게 프로젝트명을 잘랐다 —
              // 실측에서 12건 전부, 최대 110px 이 잘려 있었다. 폭은 카드에 맡기고 두 줄까지 편다.
              "line-clamp-2 max-w-full rounded-full border px-1.5 py-0.5 text-[9px] font-medium leading-tight",
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
        {/* 폰은 44px 를 그대로 누르게 하되 카드가 길어지지 않게 안쪽 여백만큼 겹친다 */}
        <span data-no-drag className={["-my-[10px] -mr-2 shrink-0 md:my-0 md:mr-0", deadlineInfo ? "" : "ml-auto"].join(" ")}>
          <StartWithOmnisIcon taskId={task.id} taskName={task.name} />
        </span>
      </div>
    </div>
  )
}

function KanbanColumn({
  status,
  label,
  color,
  tasks,
  active,
  members,
  onAssign,
}: {
  status: Status
  label: string
  color: string
  tasks: KanbanTask[]
  members?: Person[]
  onAssign?: AssignFn
  /** 좁은 화면에서는 탭으로 고른 컬럼 하나만 보인다 */
  active: boolean
}) {
  const { isOver, setNodeRef } = useDroppable({ id: status, data: { status } })
  return (
    <div
      ref={setNodeRef}
      className={[
        "min-h-0 w-full flex-1 flex-col rounded-lg border bg-muted/30 p-2.5 transition-colors sm:flex sm:w-auto sm:min-w-[260px]",
        active ? "flex" : "hidden",
        isOver ? "border-primary bg-primary/5" : "",
      ].join(" ")}
    >
      <div className="mb-2 hidden items-center gap-1.5 px-1 sm:flex">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-[11.5px] font-semibold">{label}</span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          {tasks.length}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto">
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} members={members} onAssign={onAssign} />
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

/** 좁은 화면의 상태 탭. 카드를 꾹 눌러 끌어다 놓으면 그 상태로 옮겨진다. */
function StatusTab({
  status,
  label,
  color,
  count,
  active,
  onSelect,
}: {
  status: Status
  label: string
  color: string
  count: number
  active: boolean
  onSelect: () => void
}) {
  const { isOver, setNodeRef } = useDroppable({ id: `tab:${status}`, data: { status } })
  return (
    <button
      ref={setNodeRef}
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      className={[
        "flex min-w-0 flex-col items-center gap-0.5 rounded-md border px-1 py-1.5 transition-colors",
        active ? "border-primary/40 bg-primary/10" : "bg-muted/30",
        isOver ? "border-primary bg-primary/20" : "",
      ].join(" ")}
    >
      <span className="flex items-center gap-1">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="truncate text-[11.5px] font-semibold">{label}</span>
      </span>
      <span className="font-mono text-[10.5px] text-muted-foreground">{count}</span>
    </button>
  )
}

// 상태 탭은 폭이 좁아, 끌리는 카드 사각형으로 겹침을 재면 손가락 아래가 아닌 옆 탭에 떨어졌다 —
// 손가락(포인터)이 들어간 곳을 먼저 보고, 어디에도 없을 때만 사각형 겹침으로 고른다
const pointerFirst: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  return hits.length > 0 ? hits : rectIntersection(args)
}

interface TasksBoardProps {
  initialTasks: KanbanTask[]
  /** 담당 미배정 카드의 「담당 지정」 후보 · 고른 뒤 할 일(낙관적 갱신은 부모가 한다). 없으면 「미배정」 표만 */
  members?: Person[]
  onAssign?: AssignFn
}

export function TasksBoard({ initialTasks, members, onAssign }: TasksBoardProps) {
  const [tasks, setTasks] = useState(initialTasks)
  // 빠른 필터(?filter=)로 서버가 새 목록을 내려도 처음 받은 목록을 계속 그리고 있었다 — 바뀌면 갈아 끼운다
  const [prevInitial, setPrevInitial] = useState(initialTasks)
  if (prevInitial !== initialTasks) {
    setPrevInitial(initialTasks)
    setTasks(initialTasks)
  }
  const [dragging, setDragging] = useState<KanbanTask | null>(null)
  const [activeStatus, setActiveStatus] = useState<Status>("TODO")
  const router = useRouter()
  // 터치는 꾹 눌러야 끌린다 — 바로 잡으면 목록을 넘기려던 손가락이 카드를 옮겼다
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  )

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

    const res = await fetch(apiUrl(`/api/tasks/${taskId}`), {
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
    <DndContext sensors={sensors} collisionDetection={pointerFirst} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      {/* 폰·좁은 창: 가로로 넘기면 한 화면에 한 컬럼 반밖에 안 보였다 — 네 상태를 탭으로 한눈에 두고
          고른 컬럼 하나를 꽉 채워 보여 준다 */}
      <div className="flex h-full flex-col gap-2.5 p-3 sm:flex-row sm:overflow-x-auto sm:p-4">
        <div role="tablist" aria-label="업무 상태" className="grid shrink-0 grid-cols-4 gap-1.5 sm:hidden">
          {COLUMNS.map((c) => (
            <StatusTab
              key={c.key}
              status={c.key}
              label={c.label}
              color={c.color}
              count={byStatus.get(c.key)?.length ?? 0}
              active={activeStatus === c.key}
              onSelect={() => setActiveStatus(c.key)}
            />
          ))}
        </div>
        {COLUMNS.map((c) => (
          <KanbanColumn
            key={c.key}
            status={c.key}
            label={c.label}
            color={c.color}
            tasks={byStatus.get(c.key) ?? []}
            active={activeStatus === c.key}
            members={members}
            onAssign={onAssign}
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
