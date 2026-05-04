"use client"

import { useMemo } from "react"
import type { Edge } from "@xyflow/react"
import type {
  WorkspaceProduct,
  WorkspaceTaskItem,
  WorkspaceProject,
  ProductRoomNodeData,
  ProjectCardNodeData,
  TaskNodeData,
} from "@/lib/workspace-types"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FlowNode = {
  id: string
  type: string
  position: { x: number; y: number }
  data: any
  draggable?: boolean
  selectable?: boolean
  zIndex?: number
  width?: number
  height?: number
  style?: Record<string, string | number>
}

// ─── 레이아웃 상수 ──────────────────────────────────────

const COL_X = {
  product: 50,
  project: 360,
  task: 660,
}

const ROW_H = 72 // 각 노드 row 기본 높이
const ROW_GAP = 16 // task 간 세로 간격
const PROJECT_GAP = 28 // 프로젝트 그룹 간 세로 간격
const PRODUCT_GAP = 56 // 제품 블록 간 세로 간격
const CANVAS_TOP = 50

// ─── 엣지 스타일 ────────────────────────────────────────

const EDGE_COLOR = "var(--color-border-strong)"

// ─── linkedCards mock (Inspector "연결된 HADD 카드" 검증용) ─────
// 실제 Task-OmnisCard 연결 스키마가 도입되기 전까지 projectName + 제품명 기반 임시 mock.
function mockLinkedCardsFor(params: {
  taskId: string
  projectId: string | null
  projectName: string | null
  productName: string | null
}): { id: string; title: string; checked: boolean }[] {
  const { taskId, projectId, projectName, productName } = params
  if (!projectName && !productName) return []
  const cards: { id: string; title: string; checked: boolean }[] = []
  if (projectName) {
    cards.push({
      id: `hadd-${projectId ?? taskId}-proj`,
      title: `${projectName} — 관련 HADD 카드`,
      checked: false,
    })
  }
  if (productName) {
    cards.push({
      id: `hadd-${taskId}-prod`,
      title: `${productName} 제품 개요`,
      checked: false,
    })
  }
  return cards.slice(0, 2)
}

function edgeStyle(width = 1.5, dashed = false) {
  return {
    stroke: EDGE_COLOR,
    strokeWidth: width,
    ...(dashed ? { strokeDasharray: "4 4" } : {}),
  }
}

// ─── 메인 훅 ────────────────────────────────────────────

interface UseWorkspaceNodesParams {
  products: WorkspaceProduct[]
  projects: WorkspaceProject[]
  tasks: WorkspaceTaskItem[]
  selectedProductId: string | null
  onTaskContextMenu?: (e: React.MouseEvent, taskId: string, projectId: string) => void
  onTaskClick?: (taskId: string) => void
}

export function useWorkspaceNodes({
  products,
  projects,
  tasks,
  selectedProductId,
}: UseWorkspaceNodesParams) {
  return useMemo(() => {
    const nodes: FlowNode[] = []
    const edges: Edge[] = []

    const visibleProducts = selectedProductId
      ? products.filter((p) => p.id === selectedProductId)
      : products

    // 각 제품별로 평탄한 tree 배치
    let runningY = CANVAS_TOP

    visibleProducts.forEach((product) => {
      // 이 제품의 모든 task (프로젝트 유무 무관)
      const productTasks = tasks.filter((t) => t.productId === product.id)

      // projectId 기준 그룹
      const projectIdSet = new Set<string>()
      const orphanTasks: WorkspaceTaskItem[] = []
      for (const t of productTasks) {
        if (t.projectId) projectIdSet.add(t.projectId)
        else orphanTasks.push(t)
      }

      // 이 제품에 연결된 프로젝트 (tasks 경유 + productId 직접 매칭)
      const relatedProjects: WorkspaceProject[] = []
      for (const p of projects) {
        if (p.productId === product.id || projectIdSet.has(p.id)) {
          if (!relatedProjects.find((rp) => rp.id === p.id)) relatedProjects.push(p)
        }
      }
      // 누락된 알 수 없는 projectId 보강
      for (const pid of projectIdSet) {
        if (!relatedProjects.find((p) => p.id === pid)) {
          relatedProjects.push({
            id: pid,
            name: "알 수 없는 프로젝트",
            productId: product.id,
            status: "진행 중",
          })
        }
      }

      // 활성 프로젝트(진행 중 task 1+ 또는 비어 있지 않은 프로젝트)와 완료만 남은 것 구분
      const projectBlocks: {
        project: WorkspaceProject
        projectTasks: WorkspaceTaskItem[]
        isDone: boolean
      }[] = []
      for (const proj of relatedProjects) {
        const pTasks = productTasks.filter((t) => t.projectId === proj.id)
        const activeCount = pTasks.filter((t) => t.status !== "DONE").length
        // 빈 프로젝트는 스킵
        if (pTasks.length === 0) continue
        projectBlocks.push({
          project: proj,
          projectTasks: pTasks,
          isDone: activeCount === 0,
        })
      }

      // 제품 블록의 시작 y
      const productBlockStartY = runningY

      // 프로젝트 블록 배치: 각 프로젝트를 중앙에, 그 옆에 task 들을 세로로 쌓음
      let innerY = productBlockStartY

      projectBlocks.forEach((block, idx) => {
        const taskCount = block.projectTasks.length || 1
        const blockStartY = innerY

        // 프로젝트 노드의 중심 y = 블록 중앙
        const blockHeight = taskCount * ROW_H + Math.max(0, taskCount - 1) * ROW_GAP
        const projectY = blockStartY + blockHeight / 2 - ROW_H / 2

        // project 노드
        const activeTaskCount = block.projectTasks.filter(
          (t) => t.status !== "DONE"
        ).length

        const projectData: ProjectCardNodeData = {
          projectId: block.project.id,
          projectName: block.project.name,
          productId: product.id,
          taskCount: block.projectTasks.length,
          activeTaskCount,
          isDone: block.isDone,
        }

        // 같은 프로젝트가 여러 제품에 걸쳐 있을 때 노드 ID 충돌을 막기 위해 product로 네임스페이스
        const projectNodeId = `proj-${product.id}-${block.project.id}`
        nodes.push({
          id: projectNodeId,
          type: "projectCard",
          position: { x: COL_X.project, y: projectY },
          data: projectData,
          draggable: true,
          zIndex: 5,
        })

        // Product → Project edge
        edges.push({
          id: `e-${product.id}-${block.project.id}`,
          source: `room-${product.id}`,
          target: projectNodeId,
          type: "smoothstep",
          style: edgeStyle(1.5),
        })

        // task 노드들 세로로 배치
        block.projectTasks.forEach((task, tIdx) => {
          const taskY = blockStartY + tIdx * (ROW_H + ROW_GAP)
          const taskData: TaskNodeData = {
            taskId: task.id,
            slug: task.slug,
            name: task.name,
            status: task.status,
            ownerName: task.ownerName,
            deadline: task.deadline,
            isOverdue: task.isOverdue,
            projectId: task.projectId,
            productId: task.productId,
          }
          // Inspector 매핑용 부가 필드 (projectName + HADD linkedCards mock)
          const taskDataExtra = {
            ...taskData,
            projectName: block.project.name,
            productName: product.name,
            linkedCards: mockLinkedCardsFor({
              taskId: task.id,
              projectId: task.projectId,
              projectName: block.project.name,
              productName: product.name,
            }),
          }
          nodes.push({
            id: `task-${task.id}`,
            type: "task",
            position: { x: COL_X.task, y: taskY },
            data: taskDataExtra,
            draggable: true,
            zIndex: 6,
          })

          // Project → Task edge
          edges.push({
            id: `e-${block.project.id}-${task.id}`,
            source: projectNodeId,
            target: `task-${task.id}`,
            type: "smoothstep",
            style: edgeStyle(1.2),
          })
        })

        innerY = blockStartY + blockHeight + PROJECT_GAP
        // 사용 경고 억제
        void idx
      })

      // Orphan tasks (project 없이) — 제품에서 바로 연결 (dashed)
      if (orphanTasks.length > 0) {
        const blockStartY = innerY
        orphanTasks.forEach((task, tIdx) => {
          const taskY = blockStartY + tIdx * (ROW_H + ROW_GAP)
          const taskData: TaskNodeData = {
            taskId: task.id,
            slug: task.slug,
            name: task.name,
            status: task.status,
            ownerName: task.ownerName,
            deadline: task.deadline,
            isOverdue: task.isOverdue,
            projectId: null,
            productId: task.productId,
          }
          const taskDataExtra = {
            ...taskData,
            projectName: task.projectName ?? null,
            productName: product.name,
            linkedCards: mockLinkedCardsFor({
              taskId: task.id,
              projectId: null,
              projectName: task.projectName ?? null,
              productName: product.name,
            }),
          }
          nodes.push({
            id: `task-${task.id}`,
            type: "task",
            position: { x: COL_X.task, y: taskY },
            data: taskDataExtra,
            draggable: true,
            zIndex: 6,
          })
          edges.push({
            id: `e-${product.id}-${task.id}-orphan`,
            source: `room-${product.id}`,
            target: `task-${task.id}`,
            type: "smoothstep",
            style: edgeStyle(1, true),
          })
        })
        innerY =
          blockStartY +
          orphanTasks.length * ROW_H +
          Math.max(0, orphanTasks.length - 1) * ROW_GAP +
          PROJECT_GAP
      }

      // product 노드는 세로 중앙에 배치
      const productBlockEndY = Math.max(
        innerY - PROJECT_GAP,
        productBlockStartY + ROW_H
      )
      const productCenterY =
        (productBlockStartY + productBlockEndY) / 2 - ROW_H / 2

      const roomData: ProductRoomNodeData = {
        productId: product.id,
        name: product.name,
        color: product.color,
        activeProjectCount: projectBlocks.filter((b) => !b.isDone).length,
      }

      nodes.push({
        id: `room-${product.id}`,
        type: "productRoom",
        position: { x: COL_X.product, y: productCenterY },
        data: roomData,
        draggable: true,
        zIndex: 1,
      })

      // 다음 제품은 이 블록 하단 + 간격
      runningY = productBlockEndY + PRODUCT_GAP
    })

    return { nodes, edges }
  }, [products, projects, tasks, selectedProductId])
}
