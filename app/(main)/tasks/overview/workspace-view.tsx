"use client"

import { useState, useCallback, useEffect } from "react"
import { useRouter } from "next/navigation"
import { ReactFlowProvider } from "@xyflow/react"
import { WorkspaceCanvas } from "./workspace/workspace-canvas"
import { TaskContextMenu } from "./workspace/task-context-menu"
import { useWorkspaceNodes } from "./workspace/use-workspace-nodes"
import type {
  WorkspaceProduct,
  WorkspaceTaskItem,
  WorkspaceProject,
} from "@/lib/workspace-types"

import { apiUrl } from "@/lib/base-path"

const SHOW_DONE_KEY = "omnis:workspace-show-done"

export interface WorkspaceViewProps {
  products: WorkspaceProduct[]
  projects: WorkspaceProject[]
  tasks: WorkspaceTaskItem[]
}

/**
 * 「업무」 탭의 관계도 보기. 예전 워크스페이스 화면의 캔버스 카드를 보기 토글 한 칸으로 옮겼다.
 *
 * 대시보드에서는 긴 페이지 한가운데 600px 카드라 폰에서 세로 스크롤을 캔버스가 가로챘고,
 * 그래서 좁은 화면에서는 접어 두었다. 여기서는 캔버스가 남은 화면을 다 차지하고 바깥에
 * 스크롤할 페이지가 없으니 접지 않는다 — 관계도를 고른 사람은 관계도를 보러 온 것이다.
 */
export function WorkspaceView({ products, projects, tasks }: WorkspaceViewProps) {
  const router = useRouter()
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)
  // 완료된 업무는 기본으로 숨긴다 — 쌓일수록 진행 중인 업무가 관계도에서 묻힌다(2026-09-14).
  // 보기를 켜면 이 브라우저에 기억한다.
  const [showDone, setShowDone] = useState(false)
  useEffect(() => {
    try {
      setShowDone(window.localStorage.getItem(SHOW_DONE_KEY) === "1")
    } catch {
      // 저장소를 못 읽으면 숨긴 채로 시작한다
    }
  }, [])
  const toggleShowDone = useCallback(() => {
    setShowDone((prev) => {
      try {
        window.localStorage.setItem(SHOW_DONE_KEY, prev ? "0" : "1")
      } catch {
        // 저장 실패는 이번 방문에만 영향이 있다
      }
      return !prev
    })
  }, [])
  const doneCount = tasks.filter((t) => t.status === "DONE").length
  const visibleTasks = showDone ? tasks : tasks.filter((t) => t.status !== "DONE")
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
    tasks: visibleTasks,
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
    <div className="flex h-full flex-col">
      <div className="flex min-w-0 shrink-0 items-center gap-2 border-b bg-background px-4 py-1.5">
        {/* 제품 필터는 개수가 늘면 가로 스크롤 — 320px 에서도 줄이 깨지지 않게 */}
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
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
        {doneCount > 0 && (
          <button
            type="button"
            onClick={toggleShowDone}
            aria-pressed={showDone}
            title={showDone ? "완료된 업무를 관계도에서 숨깁니다" : "완료된 업무도 관계도에 보여 줍니다"}
            className={`touch-target shrink-0 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
              showDone
                ? "border-foreground/25 bg-foreground/10 text-foreground"
                : "border-transparent bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {showDone ? `완료 숨기기 · ${doneCount}` : `완료 보기 · ${doneCount}`}
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <ReactFlowProvider>
          <WorkspaceCanvas initialNodes={nodes} initialEdges={edges} />
        </ReactFlowProvider>
      </div>

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
    </div>
  )
}
