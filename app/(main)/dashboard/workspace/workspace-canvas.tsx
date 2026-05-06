"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeTypes,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { ProductRoomNode } from "./nodes/product-room-node"
import { ProjectCardNode } from "./nodes/project-card-node"
import { TaskNode } from "./nodes/task-node"
import { resolveCollisions } from "./resolve-collisions"
import { InspectorPanel, type InspectorData } from "./inspector-panel"
import { WorkspaceToolbar, type GroupMode } from "./workspace-toolbar"
import { TASK_STATUS_LABELS } from "@/lib/constants"

const nodeTypes = {
  productRoom: ProductRoomNode,
  projectCard: ProjectCardNode,
  task: TaskNode,
} as unknown as NodeTypes

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function nodeColor(node: any) {
  switch (node.type) {
    case "productRoom":
      return (node.data?.color as string) ?? "#e5e7eb"
    case "projectCard":
      return node.data?.isDone ? "#d1d5db" : "#6366f1"
    case "task":
      if (node.data?.isOverdue) return "#ef4444"
      switch (node.data?.status) {
        case "DONE":
          return "#22c55e"
        case "IN_PROGRESS":
          return "#6366f1"
        case "REVIEW":
          return "#f59e0b"
        default:
          return "#9ca3af"
      }
    default:
      return "#d1d5db"
  }
}

type SavedLayout = {
  nodes: Record<string, { x: number; y: number }>
  viewport?: { x: number; y: number; zoom: number }
}

/** 저장된 레이아웃을 노드에 적용하고, 새 노드는 기본 위치 + 충돌 해소 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyLayout(nodes: any[], saved: SavedLayout | null) {
  if (!saved?.nodes) return resolveCollisions(nodes, { maxIterations: 30, margin: 20 })

  const applied = nodes.map((n) => {
    const pos = saved.nodes[n.id]
    if (pos && !n.parentId) {
      return { ...n, position: { x: pos.x, y: pos.y } }
    }
    return n
  })

  return resolveCollisions(applied, { maxIterations: 30, margin: 20 })
}

/** 현재 노드 위치를 추출 (부모 노드만) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractNodePositions(nodes: any[]): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {}
  for (const n of nodes) {
    if (!n.parentId) {
      positions[n.id] = { x: n.position.x, y: n.position.y }
    }
  }
  return positions
}

interface WorkspaceCanvasProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialNodes: any[]
  initialEdges: Edge[]
}

function formatDeadline(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  const now = new Date()
  const diffMs = d.getTime() - now.setHours(0, 0, 0, 0)
  const diffDays = Math.round(diffMs / 86400000)
  if (diffDays === 0) return "오늘"
  if (diffDays === 1) return "내일"
  if (diffDays === -1) return "어제"
  if (diffDays > 0) return `D-${diffDays}`
  return `${Math.abs(diffDays)}일 지연`
}

function toInspectorData(node: Node): InspectorData {
  const data = (node.data ?? {}) as Record<string, unknown>
  const projectName = typeof data.projectName === "string" ? data.projectName : undefined
  const productName = typeof data.productName === "string" ? data.productName : undefined

  // 단일 태스크 노드
  if (node.type === "task") {
    const deadline = typeof data.deadline === "string" ? data.deadline : null
    const status = typeof data.status === "string" ? data.status : undefined
    const isOverdue = typeof data.isOverdue === "boolean"
      ? data.isOverdue
      : !!(deadline && new Date(deadline) < new Date() && status !== "DONE")
    const ownerName = typeof data.ownerName === "string" ? data.ownerName : null
    const ownerInitial = ownerName ? ownerName.charAt(0) : null
    const deadlineLabel = formatDeadline(deadline)
    const shortDeadline = deadline
      ? new Date(deadline).toLocaleDateString("ko-KR", {
          month: "numeric",
          day: "numeric",
        })
      : undefined
    // 범위 외: Task-OmnisCard 연결 스키마 없음 → mock
    // use-workspace-nodes에서 주입한 data.linkedCards 우선 사용, 없으면 projectName 기반 폴백
    const projectIdRaw = typeof data.projectId === "string" ? data.projectId : null
    const rawLinked = Array.isArray((data as { linkedCards?: unknown }).linkedCards)
      ? ((data as { linkedCards: unknown[] }).linkedCards as unknown[])
      : null
    let linkedCards: { id: string; title: string; checked: boolean }[] = []
    if (rawLinked && rawLinked.length > 0) {
      linkedCards = rawLinked
        .map((c) => {
          const obj = (c ?? {}) as Record<string, unknown>
          const id = typeof obj.id === "string" ? obj.id : null
          const title = typeof obj.title === "string" ? obj.title : null
          if (!id || !title) return null
          return {
            id,
            title,
            checked: typeof obj.checked === "boolean" ? obj.checked : false,
          }
        })
        .filter((c): c is { id: string; title: string; checked: boolean } => c !== null)
    } else if (projectName && projectIdRaw) {
      linkedCards = [
        {
          id: projectIdRaw,
          title: `${projectName} — 관련 HADD 카드`,
          checked: false,
        },
      ]
    }
    const taskId = typeof data.taskId === "string" ? data.taskId : node.id.replace(/^task-/, "")
    return {
      id: taskId,
      type: "task",
      title: typeof data.name === "string" ? data.name : "업무",
      subtitle: ownerName
        ? `${ownerName}${shortDeadline ? ` · ${shortDeadline}` : ""}`
        : shortDeadline,
      slug: typeof data.slug === "string" ? data.slug : undefined,
      statusLabel: status ? TASK_STATUS_LABELS[status] ?? status : undefined,
      isOverdue,
      ownerName,
      ownerInitial,
      deadline,
      deadlineLabel,
      linkedCards,
    }
  }

  if (node.type === "productRoom") {
    const activeProjectCount =
      typeof data.activeProjectCount === "number" ? data.activeProjectCount : undefined
    return {
      id: node.id,
      type: "productRoom",
      title: productName ?? (typeof data.name === "string" ? data.name : "제품"),
      subtitle: typeof data.description === "string" ? data.description : undefined,
      activeTaskCount: activeProjectCount,
      color: typeof data.color === "string" ? data.color : undefined,
    }
  }

  // projectCard
  const activeTaskCount =
    typeof data.activeTaskCount === "number" ? data.activeTaskCount : undefined
  const taskCount =
    typeof data.taskCount === "number" ? data.taskCount : undefined
  return {
    id: node.id,
    type: node.type ?? "projectCard",
    title: projectName ?? "프로젝트",
    subtitle:
      taskCount !== undefined
        ? `진행 ${activeTaskCount ?? 0} / 전체 ${taskCount}`
        : productName,
    activeTaskCount,
  }
}

export function WorkspaceCanvas({ initialNodes, initialEdges }: WorkspaceCanvasProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes as any[])
  const [edges, , onEdgesChange] = useEdgesState(initialEdges)
  const [active, setActive] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const router = useRouter()
  const [groupMode, setGroupMode] = useState<GroupMode>("product")
  const [autoArrange, setAutoArrange] = useState(false)
  const [haddLinkMode, setHaddLinkMode] = useState(false)
  const { setViewport, getViewport, fitView } = useReactFlow()
  const savedLayoutRef = useRef<SavedLayout | null>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadedRef = useRef(false)
  const userInteractedRef = useRef(false)

  // 최초 로드: DB에서 레이아웃 가져오기
  useEffect(() => {
    fetch("/api/workspace-layout")
      .then((r) => r.json())
      .then((data) => {
        const layout = data.layout as SavedLayout | null
        const normalized: SavedLayout | null = layout
          ? layout.nodes ? layout : { nodes: layout as unknown as Record<string, { x: number; y: number }> }
          : null
        savedLayoutRef.current = normalized
        const applied = applyLayout(initialNodes, normalized)
        setNodes(applied)
        // 뷰포트 복원 또는 fitView
        setTimeout(() => {
          if (normalized?.viewport) {
            setViewport(normalized.viewport)
          } else {
            fitView({ padding: 0.08 })
          }
        }, 150)
        loadedRef.current = true
      })
      .catch(() => {
        setNodes(applyLayout(initialNodes, null))
        setTimeout(() => fitView({ padding: 0.08 }), 150)
        loadedRef.current = true
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 데이터가 바뀌면 (제품/프로젝트 변경) 저장된 레이아웃 기반으로 재계산
  useEffect(() => {
    if (!loadedRef.current) return
    setNodes(applyLayout(initialNodes, savedLayoutRef.current))
  }, [initialNodes, setNodes])

  const handleActivate = useCallback(() => {
    if (!active) {
      setActive(true)
      userInteractedRef.current = true
    }
  }, [active])

  // 드래그 중 실시간 충돌 해소
  const onNodeDrag = useCallback(() => {
    setNodes((nds) => resolveCollisions(nds, { maxIterations: 10, margin: 20 }))
  }, [setNodes])

  // DB에 레이아웃 저장 (디바운스 500ms)
  const saveLayout = useCallback(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => {
      setNodes((nds) => {
        const layout: SavedLayout = {
          nodes: extractNodePositions(nds),
          viewport: getViewport(),
        }
        savedLayoutRef.current = layout
        fetch("/api/workspace-layout", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ layout }),
        }).catch(() => {})
        return nds
      })
    }, 500)
  }, [setNodes, getViewport])

  // 드래그 끝나면 충돌 해소 + 저장
  const onNodeDragStop = useCallback(() => {
    setNodes((nds) => resolveCollisions(nds, { maxIterations: 50, margin: 20 }))
    saveLayout()
  }, [setNodes, saveLayout])

  const handleResetLayout = useCallback(() => {
    savedLayoutRef.current = null
    setNodes(applyLayout(initialNodes, null))
    setTimeout(() => fitView({ padding: 0.08 }), 50)
    fetch("/api/workspace-layout", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layout: null }),
    }).catch(() => {})
  }, [initialNodes, setNodes, fitView])

  // Toolbar 통계 계산
  const stats = (() => {
    let totalNodes = 0
    let overdueCount = 0
    let inProgressCount = 0
    for (const n of nodes) {
      // parent(group) 노드는 통계 제외
      if ((n as { parentId?: string }).parentId) {
        // 그래도 task 노드는 parent 없이 독립이므로 통계에 포함
      }
      totalNodes += 1
      const d = (n.data ?? {}) as Record<string, unknown>
      if (d.isOverdue === true) overdueCount += 1
      if (d.status === "IN_PROGRESS") inProgressCount += 1
    }
    return { totalNodes, overdueCount, inProgressCount }
  })()

  return (
    <div className="relative h-full w-full" onClick={handleActivate}>
      <WorkspaceToolbar
        groupMode={groupMode}
        onGroupChange={setGroupMode}
        autoArrange={autoArrange}
        onToggleAutoArrange={() => setAutoArrange((v) => !v)}
        haddLinkMode={haddLinkMode}
        onToggleHaddLink={() => setHaddLinkMode((v) => !v)}
        stats={stats}
        onReset={handleResetLayout}
      />

      {!active && (
        <div className="absolute inset-0 z-10 flex cursor-pointer items-center justify-center rounded-b-xl pt-10">
          <span className="rounded-full bg-foreground/5 px-3 py-1.5 text-[11px] font-medium text-muted-foreground backdrop-blur-sm">
            클릭하여 인터랙션
          </span>
        </div>
      )}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={(_, node) => setSelectedId(node.id)}
        onNodeDoubleClick={(_, node) => {
          // 핫픽스: 워크스페이스 task/project 노드 더블클릭 → 상세 라우트 직접 이동
          const data = node.data as Record<string, unknown>
          if (node.id.startsWith("task-")) {
            const taskId = typeof data.taskId === "string" ? data.taskId : node.id.replace(/^task-/, "")
            router.push(`/tasks/${taskId}`)
          } else if (node.id.startsWith("project-")) {
            // 프로젝트 노드는 인스펙터에 머무름 (전용 라우트 없음)
          }
        }}
        onPaneClick={() => setSelectedId(null)}
        onMoveEnd={() => { if (userInteractedRef.current) saveLayout() }}
        nodeTypes={nodeTypes}
        fitViewOptions={{ padding: 0.08 }}
        minZoom={0.2}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={active}
        nodesConnectable={false}
        elementsSelectable={active}
        panOnDrag={active}
        zoomOnScroll={active}
        zoomOnPinch={active}
        zoomOnDoubleClick={false}
        preventScrolling={active}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="var(--color-border-strong)"
        />
        {active && <Controls showInteractive={false} />}
        <MiniMap
          pannable
          zoomable
          position="bottom-left"
          style={{ width: 180, height: 110 }}
          nodeStrokeWidth={2}
          nodeBorderRadius={4}
          nodeColor={nodeColor}
        />
      </ReactFlow>

      <InspectorPanel
        data={
          selectedId
            ? toInspectorData(nodes.find((n) => n.id === selectedId) as Node)
            : null
        }
        dockOpen={false}
        onClose={() => setSelectedId(null)}
      />

      {active && (
        <div className="absolute right-2 top-12 z-20 flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setActive(false)
            }}
            className="rounded-md bg-foreground/10 px-2 py-1 text-[10px] font-medium text-muted-foreground backdrop-blur-sm transition-colors hover:bg-foreground/20"
          >
            잠금
          </button>
        </div>
      )}
    </div>
  )
}
