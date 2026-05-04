"use client"

import { memo } from "react"
import { Handle, Position } from "@xyflow/react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Folder01Icon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons"
import { cn } from "@/lib/utils"
import type { ProjectCardNodeData } from "@/lib/workspace-types"

interface ProjectCardNodeProps {
  data: ProjectCardNodeData
  selected?: boolean
}

export const ProjectCardNode = memo(function ProjectCardNode({
  data,
  selected,
}: ProjectCardNodeProps) {
  return (
    <div
      className={cn(
        "flex min-w-[180px] max-w-[220px] flex-col gap-1 rounded-lg border bg-card px-3 py-2 shadow-sm transition-colors",
        data.isDone ? "border-muted bg-muted/30" : "border-border",
        selected ? "ring-2 ring-primary/30" : ""
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-1.5 !w-1.5 !border-none !bg-muted-foreground/40"
      />
      <div className="flex items-center gap-1.5">
        <HugeiconsIcon
          icon={data.isDone ? CheckmarkCircle02Icon : Folder01Icon}
          size={11}
          className="shrink-0 text-muted-foreground"
        />
        <span
          className={cn(
            "flex-1 truncate text-[11.5px] font-semibold",
            data.isDone ? "text-muted-foreground line-through" : "text-foreground"
          )}
        >
          {data.projectName}
        </span>
        <span className="font-mono text-[9.5px] text-muted-foreground">
          {data.activeTaskCount}/{data.taskCount}
        </span>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-1.5 !w-1.5 !border-none !bg-muted-foreground/40"
      />
    </div>
  )
})
