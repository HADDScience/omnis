"use client"

import { useEffect, useState, type ReactNode } from "react"
import { ViewToggle } from "./view-toggle"
import { TasksBoard, type KanbanTask } from "./tasks-board"

interface TasksViewsProps {
  boardTasks: KanbanTask[]
  listSlot: ReactNode
}

const STORAGE_KEY = "omnis:tasks-view"

export function TasksViews({ boardTasks, listSlot }: TasksViewsProps) {
  const [view, setView] = useState<"list" | "board">("board")

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null
    if (saved === "list" || saved === "board") setView(saved)
  }, [])

  function handleChange(next: "list" | "board") {
    setView(next)
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, next)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-end gap-2 border-b bg-background px-4 py-2">
        <ViewToggle view={view} onChange={handleChange} />
      </div>
      <div className="flex-1 overflow-hidden">
        {view === "list" ? (
          <div className="h-full overflow-auto p-4">{listSlot}</div>
        ) : (
          <TasksBoard initialTasks={boardTasks} />
        )}
      </div>
    </div>
  )
}
