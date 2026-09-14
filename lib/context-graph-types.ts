// Context 그래프의 타입과 이름표 — 브라우저에서도 쓴다 (prisma 를 들이지 않는다)

export type ContextNodeType =
  | "task"
  | "project"
  | "user"
  | "product"
  | "org"
  | "quote"
  | "sample"
  | "invoice"
  | "record"
  | "card"
  | "ip"
  | "report"
  | "staff"

export const NODE_TYPE_LABEL: Record<ContextNodeType, string> = {
  task: "업무",
  project: "프로젝트",
  user: "사람",
  product: "제품",
  org: "기관",
  quote: "견적",
  sample: "샘플",
  invoice: "세금계산서",
  record: "연혁·실적",
  card: "지식카드",
  ip: "지식재산권",
  report: "주간보고",
  staff: "인력",
}

export const NODE_TYPE_COLOR: Record<ContextNodeType, string> = {
  task: "#6366f1",
  project: "#8b5cf6",
  user: "#0ea5e9",
  product: "#10b981",
  org: "#f59e0b",
  quote: "#f97316",
  sample: "#84cc16",
  invoice: "#f43f5e",
  record: "#14b8a6",
  card: "#3b82f6",
  ip: "#d946ef",
  report: "#64748b",
  staff: "#06b6d4",
}

export interface ContextNode {
  /** "task:<id>" 꼴. 지식재산권은 "ip:patent:PT-12" */
  key: string
  type: ContextNodeType
  label: string
  sub: string | null
  href: string | null
}

/** fk = 외래키(사실) · vector = 임베딩 거리(추정, label 에 유사도) */
export interface ContextEdge {
  from: string
  to: string
  kind: "fk" | "vector"
  label: string
}

export interface ContextChunk {
  id: string
  source: string
  title: string
  content: string
}

export interface Neighborhood {
  center: ContextNode
  nodes: ContextNode[]
  edges: ContextEdge[]
  /** 이 대상에 대해 AI 가 실제로 읽는 벡터 조각 */
  chunks: ContextChunk[]
  chunkNote: string | null
  /** 「업무 120건 중 20건만」 같은 잘림 안내 */
  truncated: string[]
  ms?: number
}
