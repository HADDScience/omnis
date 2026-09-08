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
import { useMediaQuery } from "@/hooks/use-media-query"
import type {
  WorkspaceProduct,
  WorkspaceTaskItem,
  WorkspaceProject,
} from "@/lib/workspace-types"

import { apiUrl } from "@/lib/base-path"
interface DashboardWorkspaceProps {
  products: WorkspaceProduct[]
  projects: WorkspaceProject[]
  tasks: WorkspaceTaskItem[]
}

export function DashboardWorkspace({
  products,
  projects,
  tasks,
}: DashboardWorkspaceProps) {
  const router = useRouter()
  const isMdUp = useMediaQuery("(min-width: 768px)")
  // 좁은 화면에서는 기본 접힘 (규칙 30) — 600px 캔버스가 폰 화면을 다 덮고
  // 세로 스크롤 제스처를 캔버스가 가로챈다. 사용자가 토글하면 그 선택을 따른다.
  const [collapsed, setCollapsed] = useState<boolean | null>(null)
  const isCollapsed = collapsed ?? !isMdUp
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
    async (taskId: string, updates: { projectId?: string; productId?: string | null }) => {
      try {
        await fetch(apiUrl(`/api/tasks/${taskId}`), {
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
        {/* CardHeader 는 grid — min-w-0 가 없으면 이 행이 축소되지 못하고
            Card 의 overflow-hidden 에 잘려 나간다 (320px 실측 확인) */}
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">워크스페이스</CardTitle>
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
            {/* 제품 필터는 개수가 늘면 가로 스크롤 — 320px 에서도 줄이 깨지지 않게 */}
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] sm:flex-none">
              <button
                onClick={() => setSelectedProductId(null)}
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
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
                  className={`flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
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
              className="h-7 w-7 shrink-0"
              aria-label={isCollapsed ? "워크스페이스 펼치기" : "워크스페이스 접기"}
              aria-expanded={!isCollapsed}
              onClick={() => setCollapsed(!isCollapsed)}
            >
              <HugeiconsIcon
                icon={isCollapsed ? ArrowDown01Icon : ArrowUp01Icon}
                size={14}
                aria-hidden
              />
            </Button>
          </div>
        </div>
      </CardHeader>
      {isCollapsed ? (
        <CardContent className="pt-0">
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="w-full rounded-md border border-dashed px-3 py-3 text-[11.5px] text-muted-foreground transition-colors hover:bg-muted/50"
          >
            워크스페이스 관계도 펼치기
            {!isMdUp && " · 두 손가락으로 확대·이동합니다"}
          </button>
        </CardContent>
      ) : (
        <CardContent className="p-0">
          <div className="h-[60svh] max-h-[600px] min-h-[320px] w-full md:h-[600px]">
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
            categoryId: null,
            categoryName: null,
            productId: contextTask.productId,
            productName: null,
            projectId: contextTask.projectId,
            projectName: contextTask.projectName,
            checklistDone: contextTask.checklistDone,
            checklistTotal: contextTask.checklistTotal,
            ownerName: contextTask.ownerName,
          }}
          products={products}
          projects={projects}
          onClose={() => setContextMenu(null)}
          onSave={handleContextMenuSave}
        />
      )}
    </Card>
  )
}
