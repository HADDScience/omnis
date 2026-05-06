"use client"

import Link from "next/link"
import { cva, type VariantProps } from "class-variance-authority"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { PriorityRating } from "@/components/ui/priority-rating"
import { TASK_STATUS_LABELS, TASK_STATUS_COLORS } from "@/lib/constants"
import { cn } from "@/lib/utils"

/**
 * 단일 도메인 (Task) → 단일 카드 컴포넌트 + variant (omnis/CLAUDE.md 규칙 19).
 * variant:
 *   - "list": 한 줄 가로 행 (테이블 같은 레이아웃)
 *   - "board": 세로 카드 (칸반 컬럼 안)
 */
export interface TaskCardData {
  id: string
  slug: string
  name: string
  status: string
  priority: string | null
  ownerName: string | null
  projectName: string | null
  productName: string | null
  productColor: string | null
  deadline: string | null
}

const cardVariants = cva(
  "group block rounded-md border bg-card transition-colors hover:border-border-strong",
  {
    variants: {
      variant: {
        list: "flex items-center gap-3 px-3 py-2",
        board: "flex flex-col gap-1.5 p-2.5 cursor-grab",
      },
    },
    defaultVariants: { variant: "board" },
  },
)

interface TaskCardProps extends VariantProps<typeof cardVariants> {
  task: TaskCardData
  className?: string
}

function formatDeadline(deadline: string | null, isDone: boolean) {
  if (!deadline) return null
  const target = new Date(deadline)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate())
  const diffDays = Math.round((targetDay.getTime() - today.getTime()) / 86400000)
  if (!isDone && diffDays < 0) {
    return { text: `D+${Math.abs(diffDays)}`, className: "text-destructive font-medium", overdue: true }
  }
  if (diffDays === 0) return { text: "오늘", className: "text-orange-500 font-semibold", overdue: false }
  if (diffDays <= 7) return { text: `D-${diffDays}`, className: "text-foreground font-medium", overdue: false }
  return {
    text: target.toLocaleDateString("ko-KR", { month: "short", day: "numeric" }),
    className: "text-muted-foreground",
    overdue: false,
  }
}

export function TaskCard({ task, variant = "board", className }: TaskCardProps) {
  const isDone = task.status === "DONE"
  const deadlineInfo = formatDeadline(task.deadline, isDone)
  const overdue = deadlineInfo?.overdue ?? false

  // 제품 / 프로젝트 breadcrumb (#11)
  const projectChip = task.projectName ? (
    <span className="inline-flex items-center truncate rounded-full border bg-muted/50 px-1.5 text-[10px] font-medium leading-tight text-muted-foreground">
      {task.productName ? <span>{task.productName} / </span> : null}
      {task.projectName}
    </span>
  ) : null

  if (variant === "list") {
    return (
      <Link
        href={`/tasks/${task.id}`}
        className={cn(
          cardVariants({ variant: "list" }),
          overdue ? "border-destructive/30 bg-destructive/5" : "",
          className,
        )}
      >
        <Badge
          variant="secondary"
          className={cn("h-5 shrink-0 text-[10px]", TASK_STATUS_COLORS[task.status] ?? "")}
        >
          {TASK_STATUS_LABELS[task.status] ?? task.status}
        </Badge>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[13px] font-medium",
            isDone && "text-muted-foreground line-through",
          )}
        >
          {task.name}
        </span>
        {task.priority && <PriorityRating value={task.priority} disabled size={12} />}
        {projectChip}
        {task.ownerName && (
          <Avatar className="h-6 w-6 shrink-0">
            <AvatarFallback className="text-[10px]">{task.ownerName.charAt(0)}</AvatarFallback>
          </Avatar>
        )}
        {deadlineInfo && (
          <span className={cn("shrink-0 font-mono text-[10.5px]", deadlineInfo.className)}>
            {deadlineInfo.text}
          </span>
        )}
      </Link>
    )
  }

  // board variant — 세로 카드
  return (
    <Link
      href={`/tasks/${task.id}`}
      className={cn(
        cardVariants({ variant: "board" }),
        overdue ? "ring-1 ring-destructive/30" : "",
        className,
      )}
    >
      <div className="flex items-center gap-1.5">
        <Badge
          variant="secondary"
          className={cn("h-4 px-1 text-[9px]", TASK_STATUS_COLORS[task.status] ?? "")}
        >
          {TASK_STATUS_LABELS[task.status] ?? task.status}
        </Badge>
        <span className="font-mono text-[9.5px] text-muted-foreground">#{task.slug}</span>
        {overdue && (
          <Badge variant="destructive" className="ml-auto h-4 px-1 text-[9px]">
            지연
          </Badge>
        )}
      </div>
      <span className={cn("text-[12.5px] font-medium leading-snug", isDone && "line-through text-muted-foreground")}>
        {task.name}
      </span>
      <div className="flex items-center gap-1.5">
        {task.priority && <PriorityRating value={task.priority} disabled size={11} />}
        {projectChip}
        {task.ownerName && (
          <Avatar className="ml-auto h-5 w-5 shrink-0">
            <AvatarFallback className="text-[9px]">{task.ownerName.charAt(0)}</AvatarFallback>
          </Avatar>
        )}
        {deadlineInfo && (
          <span className={cn("shrink-0 font-mono text-[10px]", deadlineInfo.className)}>
            {deadlineInfo.text}
          </span>
        )}
      </div>
    </Link>
  )
}
