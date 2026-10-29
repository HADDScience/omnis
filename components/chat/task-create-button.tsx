"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { HugeiconsIcon } from "@hugeicons/react"
import { PlusSignIcon } from "@hugeicons/core-free-icons"
import { TaskCmdModal } from "./task-cmd-modal"

interface TaskCreateButtonProps {
  label?: string
  className?: string
  /** 좁은 툴바에서 글자를 숨기고 + 만 남길 때 (예: "sr-only sm:not-sr-only") */
  labelClassName?: string
}

export function TaskCreateButton({ label = "새 업무", className, labelClassName }: TaskCreateButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        size="sm"
        variant="default"
        className={["shrink-0 gap-1.5", className].filter(Boolean).join(" ")}
        onClick={() => setOpen(true)}
      >
        <HugeiconsIcon icon={PlusSignIcon} size={14} aria-hidden />
        <span className={labelClassName}>{label}</span>
      </Button>

      <TaskCmdModal
        open={open}
        rawCommand=""
        onClose={() => setOpen(false)}
      />
    </>
  )
}
