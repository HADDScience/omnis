"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { HugeiconsIcon } from "@hugeicons/react"
import { PlusSignIcon } from "@hugeicons/core-free-icons"
import { TaskCmdModal } from "./task-cmd-modal"

interface TaskCreateButtonProps {
  label?: string
  className?: string
}

export function TaskCreateButton({ label = "새 업무", className }: TaskCreateButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        size="sm"
        variant="default"
        className={["shrink-0 gap-1.5", className].filter(Boolean).join(" ")}
        onClick={() => setOpen(true)}
      >
        <HugeiconsIcon icon={PlusSignIcon} size={14} />
        {label}
      </Button>

      <TaskCmdModal
        open={open}
        rawCommand=""
        onClose={() => setOpen(false)}
      />
    </>
  )
}
