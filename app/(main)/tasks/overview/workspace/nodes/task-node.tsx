"use client"

import { memo } from "react"
import { Handle, Position } from "@xyflow/react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Alert02Icon } from "@hugeicons/core-free-icons"
import { cn } from "@/lib/utils"
import type { TaskNodeData } from "@/lib/workspace-types"

const STATUS_DOT: Record<string, string> = {
  TODO: "bg-muted-foreground/50",
  IN_PROGRESS: "bg-primary",
  REVIEW: "bg-[var(--color-warn)]",
  DONE: "bg-[var(--color-success)]",
}

interface TaskNodeProps {
  data: TaskNodeData
  selected?: boolean
}

export const TaskNode = memo(function TaskNode({
  data,
  selected,
}: TaskNodeProps) {
  const isDone = data.status === "DONE"
  return (
    <div
      className={cn(
        "group/task flex min-w-[200px] max-w-[240px] flex-col gap-1 rounded-lg border bg-card px-3 py-2 shadow-sm transition-colors",
        isDone && "opacity-70",
        data.isOverdue
          ? "border-destructive/40 ring-1 ring-destructive/20"
          : "border-border",
        selected ? "border-primary ring-2 ring-primary/30" : ""
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-1.5 !w-1.5 !border-none !bg-muted-foreground/40"
      />
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            STATUS_DOT[data.status] ?? "bg-muted-foreground/40"
          )}
        />
        <span className="font-mono text-[9.5px] text-muted-foreground">
          #{data.slug}
        </span>
        {data.isOverdue && (
          <span className="ml-auto inline-flex items-center gap-0.5 rounded bg-destructive/10 px-1 py-0.5 text-[9px] font-semibold text-destructive">
            <HugeiconsIcon icon={Alert02Icon} size={9} />
            지연
          </span>
        )}
      </div>
      <div
        className={cn(
          "truncate text-[11.5px] font-medium text-foreground",
          isDone && "line-through text-muted-foreground"
        )}
      >
        {data.name}
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="truncate">{data.ownerName ?? "—"}</span>
        {data.deadline && (
          <span className="font-mono">
            {new Date(data.deadline).toLocaleDateString("ko-KR", {
              month: "numeric",
              day: "numeric",
            })}
          </span>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-1.5 !w-1.5 !border-none !bg-muted-foreground/40"
      />
    </div>
  )
})
