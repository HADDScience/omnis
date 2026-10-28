"use client"

import { useEffect, useState, type ReactNode } from "react"
import dynamic from "next/dynamic"
import { Skeleton } from "@/components/ui/skeleton"
import { ViewToggle, type TasksView } from "./view-toggle"
import { TasksBoard, type KanbanTask } from "./tasks-board"
import type { WorkspaceViewProps } from "./overview/workspace-view"

// 관계도는 React Flow 를 통째로 싣는다 — 목록·보드만 보는 사람이 그 무게를 내려받지 않게 고를 때 불러온다
const WorkspaceView = dynamic(
  () => import("./overview/workspace-view").then((m) => m.WorkspaceView),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full flex-col gap-3 p-4" aria-busy aria-label="관계도 불러오는 중">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="min-h-0 flex-1 rounded-lg" />
      </div>
    ),
  }
)

interface TasksViewsProps {
  boardTasks: KanbanTask[]
  listSlot: ReactNode
  workspace: WorkspaceViewProps
  /** 툴바 왼쪽 — 건수와 걸린 필터 */
  toolbarStart: ReactNode
  /** 툴바 오른쪽 끝 — 보기 토글 뒤에 놓이는 동작들 */
  toolbarEnd: ReactNode
}

const STORAGE_KEY = "omnis:tasks-view"
const VIEWS: readonly TasksView[] = ["list", "board", "graph"]

export function TasksViews({ boardTasks, listSlot, workspace, toolbarStart, toolbarEnd }: TasksViewsProps) {
  // 저장된 보기는 마운트 뒤에 읽는다 — 첫 렌더에서 읽으면 서버(보드)와 어긋나 hydration 이 깨진다
  const [view, setView] = useState<TasksView>("board")
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (VIEWS.includes(saved as TasksView)) setView(saved as TasksView)
    } catch {
      // 저장소를 못 읽으면 보드로 둔다
    }
  }, [])

  function handleChange(next: TasksView) {
    setView(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // 저장 실패는 이번 방문에만 영향이 있다
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* 보기 토글이 툴바 줄 안에 들어가도록 툴바째로 여기서 그린다 — 줄 하나를 아낀다 */}
      <div className="flex flex-wrap items-center gap-2 border-b bg-background px-4 py-2">
        {toolbarStart}
        <div className="ml-auto flex items-center gap-1.5">
          <ViewToggle view={view} onChange={handleChange} />
          {toolbarEnd}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {view === "list" ? (
          <div className="h-full overflow-auto p-4">{listSlot}</div>
        ) : view === "board" ? (
          <TasksBoard initialTasks={boardTasks} />
        ) : (
          <WorkspaceView {...workspace} />
        )}
      </div>
    </div>
  )
}
