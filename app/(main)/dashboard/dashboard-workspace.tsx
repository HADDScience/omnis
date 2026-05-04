"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { ReactFlowProvider } from "@xyflow/react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown01Icon, ArrowUp01Icon } from "@hugeicons/core-free-icons"
import { WorkspaceCanvas } from "./workspace/workspace-canvas"
import { TaskContextMenu } from "./workspace/task-context-menu"
import { useWorkspaceNodes } from "./workspace/use-workspace-nodes"
import type {
  WorkspaceProduct,
  WorkspaceCategory,
  WorkspaceTaskItem,
  WorkspaceProject,
} from "@/lib/workspace-types"

interface DashboardWorkspaceProps {
  products: WorkspaceProduct[]
  categories: WorkspaceCategory[]
  projects: WorkspaceProject[]
  tasks: WorkspaceTaskItem[]
}

export function DashboardWorkspace({
  products,
  categories,
  projects,
  tasks,
}: DashboardWorkspaceProps) {
  const router = useRouter()
  const [collapsed, setCollapsed] = useState(false)
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    taskId: string
    projectId: string
  } | null>(null)

  const handleTaskClick = useCallback(
    (taskId: string) => {
      router.push(`/tasks/${taskId}`)
    },
    [router]
  )

  const handleTaskContextMenu = useCallback(
    (e: React.MouseEvent, taskId: string, projectId: string) => {
      e.preventDefault()
      setContextMenu({ x: e.clientX, y: e.clientY, taskId, projectId })
    },
    []
  )

  const { nodes, edges } = useWorkspaceNodes({
    products,
    projects,
    tasks,
    selectedProductId,
    onTaskContextMenu: handleTaskContextMenu,
    onTaskClick: handleTaskClick,
  })

  const handleContextMenuSave = useCallback(
    async (taskId: string, updates: { categoryId?: string; projectId?: string; productId?: string }) => {
      try {
        await fetch(`/api/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        })
        router.refresh()
      } catch (e) {
        console.error("업무 수정 실패:", e)
      }
      setContextMenu(null)
    },
    [router]
  )

  // 컨텍스트 메뉴용 task 데이터 조회
  const contextTask = contextMenu
    ? tasks.find((t) => t.id === contextMenu.taskId)
    : null

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">워크스페이스</CardTitle>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setSelectedProductId(null)}
                className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
                  selectedProductId === null
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                전체
              </button>
              {products.map((p) => (
                <button
                  key={p.id}
                  onClick={() =>
                    setSelectedProductId((prev) =>
                      prev === p.id ? null : p.id
                    )
                  }
                  className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
                    selectedProductId === p.id
                      ? "text-white"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                  style={
                    selectedProductId === p.id
                      ? { backgroundColor: p.color }
                      : undefined
                  }
                >
                  <div
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: p.color }}
                  />
                  {p.name}
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setCollapsed(!collapsed)}
            >
              <HugeiconsIcon
                icon={collapsed ? ArrowDown01Icon : ArrowUp01Icon}
                size={14}
              />
            </Button>
          </div>
        </div>
      </CardHeader>
      {!collapsed && (
        <CardContent className="p-0">
          <div className="h-[600px] w-full">
            <ReactFlowProvider>
              <WorkspaceCanvas initialNodes={nodes} initialEdges={edges} />
            </ReactFlowProvider>
          </div>
        </CardContent>
      )}

      {contextMenu && contextTask && (
        <TaskContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          task={{
            taskId: contextTask.id,
            name: contextTask.name,
            status: contextTask.status,
            priority: "",
            categoryId: contextTask.categoryId,
            categoryName: contextTask.categoryName,
            productId: contextTask.productId,
            productName: null,
            projectId: contextTask.projectId,
            projectName: contextTask.projectName,
            checklistDone: contextTask.checklistDone,
            checklistTotal: contextTask.checklistTotal,
            ownerName: contextTask.ownerName,
          }}
          products={products}
          categories={categories}
          projects={projects}
          onClose={() => setContextMenu(null)}
          onSave={handleContextMenuSave}
        />
      )}
    </Card>
  )
}
