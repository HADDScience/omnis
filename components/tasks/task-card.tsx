"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { PriorityRating } from "@/components/ui/priority-rating"
import { TASK_STATUS_LABELS, TASK_STATUS_COLORS } from "@/lib/constants"
import { UNASSIGNED_LABEL } from "@/lib/task-unassigned"
import { cn } from "@/lib/utils"
import { AssigneeStack } from "./assignee-stack"

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
  /** 목록 검색용 담당자 전체 이름 — ownerName 은 3명을 넘으면 접혀 뒤 사람을 찾지 못한다 */
  ownerSearch?: string
  /** 담당자 전체 — 겹친 아바타 · 담당 바꾸기 칩이 쓴다. 없으면 ownerName 첫 글자 하나로 그린다(옛 데이터 · 시연) */
  owners?: { id: string; name: string }[]
  /** 미완료인데 담당자가 없다 — lib/task-unassigned.ts */
  unassigned?: boolean
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
  /** Tutorial previews share the real card without linking to a demo task. */
  readOnly?: boolean
  /**
   * list 행 오른쪽 끝, 상세로 가는 링크 **밖**에 놓을 단추들(담당 지정 칩 · Omnis 와 시작).
   * 링크 안에 단추를 두면 누를 때 상세로 넘어가 버린다 — 행 테두리 안에서 링크와 나란히 둔다.
   * 담당 지정 칩이 있으면 「미배정」 표를 따로 달지 않는다(같은 말을 두 번 하지 않는다).
   */
  actions?: ReactNode
  /** actions 안에 담당 지정 칩이 있다 */
  assignInActions?: boolean
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

const UNASSIGNED_BADGE = (
  <Badge variant="outline" className="h-5 shrink-0 border-destructive/40 px-1.5 text-[10px] text-destructive">
    {UNASSIGNED_LABEL}
  </Badge>
)

function CardSurface({ readOnly, href, className, children }: { readOnly: boolean; href: string; className: string; children: ReactNode }) {
  return readOnly ? <div className={cn(className, "cursor-default")}>{children}</div> : <Link href={href} className={className}>{children}</Link>
}

export function TaskCard({ task, variant = "board", className, readOnly = false, actions, assignInActions = false }: TaskCardProps) {
  const isDone = task.status === "DONE"
  const deadlineInfo = formatDeadline(task.deadline, isDone)
  const overdue = deadlineInfo?.overdue ?? false

  // 제품 / 프로젝트 breadcrumb (#11)
  const projectChip = task.projectName ? (
    <span className="min-w-0 truncate rounded-full border bg-muted/50 px-1.5 text-[10px] font-medium leading-tight text-muted-foreground">
      {task.productName ? `${task.productName} / ` : ""}{task.projectName}
    </span>
  ) : null

  if (variant === "list") {
    const rowClass = cn(cardVariants({ variant: "list" }), overdue ? "border-destructive/30 bg-destructive/5" : "", className)
    const content = (
      <>
        <Badge
          variant="secondary"
          className={cn("h-5 shrink-0 text-[10px]", TASK_STATUS_COLORS[task.status] ?? "")}
        >
          {TASK_STATUS_LABELS[task.status] ?? task.status}
        </Badge>
        {/* 프로젝트 칩을 제목 옆에 두면 긴 프로젝트명이 줄어들지 않고 제목 자리를 다 먹었다 —
            제목 아래로 내려 한 줄로 자른다 */}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            className={cn(
              // 한 줄로 자르면 좁은 화면에서 제목 절반이 사라진다 — 두 줄까지 편다
              "line-clamp-2 text-[13px] font-medium",
              isDone && "text-muted-foreground line-through",
            )}
          >
            {task.name}
          </span>
          {task.projectName && (
            <span
              className="truncate text-[10.5px] text-muted-foreground"
              title={[task.productName, task.projectName].filter(Boolean).join(" / ")}
            >
              {task.productName ? `${task.productName} / ` : ""}{task.projectName}
            </span>
          )}
        </span>
        {task.priority && <PriorityRating value={task.priority} disabled size={12} />}
        {task.unassigned && !assignInActions && UNASSIGNED_BADGE}
        {/* 담당 단추가 행 오른쪽(actions)에 있으면 거기서 겹친 아바타를 그린다 — 두 번 그리지 않는다 */}
        {!assignInActions && <OwnerFaces task={task} size="sm" />}
        {deadlineInfo && (
          <span className={cn("shrink-0 font-mono text-[10.5px]", deadlineInfo.className)}>
            {deadlineInfo.text}
          </span>
        )}
      </>
    )
    if (actions && !readOnly) {
      return (
        <div className={cn(rowClass, "gap-1.5 py-0 pr-1 md:pr-2")} data-task-row={task.id}>
          <Link href={`/tasks/${task.id}`} className="flex min-w-0 flex-1 items-center gap-3 self-stretch py-2">
            {content}
          </Link>
          <div data-task-row-actions className="flex shrink-0 items-center gap-0.5">
            {actions}
          </div>
        </div>
      )
    }
    return (
      <CardSurface readOnly={readOnly} href={`/tasks/${task.id}`} className={rowClass}>
        {content}
      </CardSurface>
    )
  }

  // board variant — 세로 카드
  return (
    <CardSurface
        readOnly={readOnly}
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
        {task.unassigned && UNASSIGNED_BADGE}
        <OwnerFaces task={task} size="xs" className="ml-auto" />
        {deadlineInfo && (
          <span className={cn("shrink-0 font-mono text-[10px]", deadlineInfo.className)}>
            {deadlineInfo.text}
          </span>
        )}
      </div>
    </CardSurface>
  )
}

/** 담당 얼굴 — 담당 목록이 있으면 겹친 아바타 + 「외 n명」, 없으면(옛 데이터) 한 줄 이름의 첫 글자 */
function OwnerFaces({ task, size, className }: { task: TaskCardData; size: "xs" | "sm"; className?: string }) {
  if (task.owners && task.owners.length > 0) return <AssigneeStack people={task.owners} size={size} className={className} />
  if (!task.ownerName) return null
  return (
    <Avatar className={cn(size === "xs" ? "h-5 w-5" : "h-6 w-6", "shrink-0", className)}>
      <AvatarFallback className={size === "xs" ? "text-[9px]" : "text-[10px]"}>{task.ownerName.charAt(0)}</AvatarFallback>
    </Avatar>
  )
}
