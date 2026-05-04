// ─── 서버에서 전달되는 원본 데이터 ─────────────────────

export interface WorkspaceProduct {
  id: string
  name: string
  color: string
}

export interface WorkspaceCategory {
  id: string
  name: string
  icon: string | null
  color: string | null
  sortOrder: number
}

export interface WorkspaceProject {
  id: string
  name: string
  productId: string | null
  status: string
}

export interface WorkspaceTaskItem {
  id: string
  name: string
  slug: string
  status: string
  priority: string
  categoryId: string | null
  categoryName: string | null
  productId: string | null
  projectId: string | null
  projectName: string | null
  ownerId: string
  ownerName: string
  deadline: string | null
  isOverdue: boolean
  checklistDone: number
  checklistTotal: number
}

// ─── React Flow 노드 데이터 타입 ─────────────────────

/** 제품 방 — 마인드맵 최상위 노드 */
export interface ProductRoomNodeData {
  productId: string | null
  name: string
  color: string
  activeProjectCount: number
}

/** 프로젝트 카드 — 마인드맵 중간 노드 (task 리스트 없음) */
export interface ProjectCardNodeData {
  projectId: string
  projectName: string
  productId: string | null
  taskCount: number
  activeTaskCount: number
  isDone: boolean
}

/** 업무 노드 — 마인드맵 말단 노드 */
export interface TaskNodeData {
  taskId: string
  slug: string
  name: string
  status: "TODO" | "IN_PROGRESS" | "REVIEW" | "DONE" | string
  ownerName: string | null
  deadline: string | null
  isOverdue: boolean
  projectId: string | null
  productId: string | null
}

/** 업무 뱃지 — 우클릭 컨텍스트 메뉴용 데이터 */
export interface TaskBadgeNodeData {
  taskId: string
  name: string
  status: string
  priority: string
  categoryId: string | null
  categoryName: string | null
  productId: string | null
  productName: string | null
  projectId: string | null
  projectName: string | null
  checklistDone: number
  checklistTotal: number
  ownerName: string
}
