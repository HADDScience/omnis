/**
 * data/seed.json 의 타입 정의.
 * 시드는 실제 업무 데이터이므로 값은 그대로 두고, 여기서 형태만 고정한다.
 */

export const TRADEMARK_STATUSES = [
  "등록완료",
  "출원준비",
  "검토중",
  "거절결정",
  "중단",
  "아이디어",
] as const
export type TrademarkStatus = (typeof TRADEMARK_STATUSES)[number]

export const PATENT_STATUSES = ["등록", "출원", "출원준비"] as const
export type PatentStatus = (typeof PATENT_STATUSES)[number]

export const PRIORITIES = ["높음", "보통", "낮음"] as const
export type Priority = (typeof PRIORITIES)[number]

export const TARGETS = ["상표", "특허", "관리"] as const
export type Target = (typeof TARGETS)[number]

export type Direction = "발신" | "수신"

export interface Firm {
  name: string
  attorney: string
  email: string
  tel: string
  mobile: string
  staff: string[]
}

export interface Meta {
  org: string
  /** 시드 스냅샷 기준일 (KST, YYYY-MM-DD) */
  asOf: string
  owner: string
  firm: Firm
  note: string
}

export interface Trademark {
  id: string
  name: string
  nameKo: string
  classes: string[]
  goods: string | null
  appNo: string | null
  regNo: string | null
  /** 마지막 진행일 (KST, YYYY-MM-DD) — 정체 일수 계산의 근거 */
  date: string | null
  filedOn: string | null
  registeredOn: string | null
  holder: string | null
  status: string
  /** 변리사 판단 등록가능성(%) */
  probability: number | null
  note: string
}

export interface Patent {
  id: string
  title: string
  appNo: string | null
  regNo: string | null
  /** 마지막 진행일 (KST, YYYY-MM-DD) */
  date: string | null
  filedOn: string | null
  registeredOn: string | null
  applicant: string
  status: string
  note: string
}

// ---------------------------------------------------------------------------
// 진행 기록 — 사용자가 채우는 유일한 양식
// ---------------------------------------------------------------------------

/** 지금 누구 차례인지. 미결 액션을 따로 등록하지 않기 위한 장치. */
export const NEXT_TURNS = ["us", "firm", "none"] as const
export type NextTurn = (typeof NEXT_TURNS)[number]

export const NEXT_TURN_LABEL: Record<NextTurn, string> = {
  // 「밀린 IP 업무」 화면의 집계 이름과 같은 말을 쓴다. 입력할 때 고른 말이
  // 그대로 목록 제목으로 나와야 둘이 이어져 보인다.
  us: "회신 필요",
  firm: "상대 회신 대기",
  none: "대기 없음",
}

/** ip.status_options 한 행. 파이프라인 단계 정의이자 배지 색·조건부 입력칸의 출처. */
export interface Stage {
  kind: "trademark" | "patent"
  value: string
  sortOrder: number
  tone: string
  isOpen: boolean
  /** 이 단계를 고르면 추가로 물어볼 칸 */
  wantsAppNo: boolean
  wantsRegNo: boolean
  wantsProbability: boolean
  wantsDue: boolean
  selectable: boolean
}

/** 이 기록이 어디서 왔는지. edit 는 IP 화면에서 값을 고쳐 생긴 기록이다. */
export type ProgressSource = "manual" | "mail" | "excel" | "edit"

/**
 * 권리 부류. 출원번호 앞 두 자리가 곧 부류다.
 * 지금 실제로 보유한 것은 상표·특허뿐이라 나머지는 자리만 잡아 둔다.
 */
export const RIGHT_KINDS = [
  {
    value: "trademark",
    label: "상표",
    numPrefix: "40",
    idPrefix: "TM",
    live: true,
  },
  {
    value: "patent",
    label: "특허",
    numPrefix: "10",
    idPrefix: "PT",
    live: true,
  },
  {
    value: "utility",
    label: "실용신안",
    numPrefix: "20",
    idPrefix: "UM",
    live: false,
  },
  {
    value: "design",
    label: "디자인",
    numPrefix: "30",
    idPrefix: "DS",
    live: false,
  },
] as const

export type RightKind = (typeof RIGHT_KINDS)[number]["value"]

/** 진행 기록의 방향. 레거시 커뮤니케이션 로그의 「발신」과 달리 「송신」을 쓴다. */
export const PROGRESS_DIRECTIONS = ["수신", "송신"] as const
export type ProgressDirection = (typeof PROGRESS_DIRECTIONS)[number]

export interface ProgressEntry {
  id: string
  date: string
  entityKind: "trademark" | "patent"
  entityId: string
  stage: string
  /** 메일로 주고받은 기록이면 방향, 내부 결정이면 null */
  direction: ProgressDirection | null
  counterpart: string
  nextTurn: NextTurn
  dueOn: string | null
  appNo: string | null
  regNo: string | null
  probability: number | null
  /** 값 정정으로 바꾼 이름(상표) · 명칭(특허). 안 바꿨으면 null */
  name: string | null
  /** 값 정정으로 바꾼 보유자 · 출원인. 안 바꿨으면 null */
  holder: string | null
  note: string
  source: ProgressSource
  raw: string | null
  /** 적힌 시각. 같은 날 기록끼리 순서를 가르는 데만 쓴다. */
  createdAt: string
}

export interface Communication {
  /** DB uuid. 신규 작성 중인 항목은 아직 없을 수 있다. */
  id: string
  date: string
  dir: Direction
  from: string
  to: string
  target: Target
  subject: string
  body: string
  attachments: string[]
  followUp: string
  /** 미결(후속 조치 필요) 여부 */
  open: boolean
  /** Gmail 원문 딥링크에 쓰는 스레드 ID */
  threadId: string | null
  /** 연결된 상표/특허 ID */
  links: CommunicationLink[]
}

export interface CommunicationLink {
  kind: "trademark" | "patent"
  id: string
}

export const ACTION_STATES = ["open", "done", "dropped"] as const
export type ActionState = (typeof ACTION_STATES)[number]

export const ACTION_STATE_LABEL: Record<ActionState, string> = {
  open: "미결",
  done: "완료",
  dropped: "보류/취소",
}

export interface ActionItem {
  id: string
  target: Target
  subject: string
  requestedAt: string | null
  requester: string | null
  todo: string
  owner: string
  priority: Priority
  note: string
  state: ActionState
  resolution: string | null
  resolvedAt: string | null
}

export const FLAG_STATES = ["open", "resolved", "dismissed"] as const
export type FlagState = (typeof FLAG_STATES)[number]

export const FLAG_STATE_LABEL: Record<FlagState, string> = {
  open: "확인 필요",
  resolved: "해결됨",
  dismissed: "해당 없음",
}

/** ip.integrity_flags 한 행 */
export interface IntegrityFlagRow {
  id: string
  entityKind: "trademark" | "patent" | "action" | "general"
  entityId: string | null
  message: string
  source: "note" | "detector" | "manual"
  state: FlagState
  resolution: string | null
  resolvedAt: string | null
}

/** 상태 룩업 (ip.status_options) */
export interface StatusOption {
  kind: "trademark" | "patent"
  value: string
  sortOrder: number
  tone: string
  isOpen: boolean
}

export interface SeedData {
  meta: Meta
  trademarks: Trademark[]
  patents: Patent[]
  communications: Communication[]
  actions: ActionItem[]
}

/** 상표/특허 어느 쪽이든 "정체 판정" 대상이 되는 공통 형태 */
export interface StaleItem {
  kind: "상표" | "특허"
  id: string
  label: string
  status: string
  date: string | null
  days: number | null
}

/** note 안에서 "※" 로 시작하는 확인 필요 문구를 뽑아낸 결과 */
export interface IntegrityFlag {
  kind: "상표" | "특허"
  id: string
  label: string
  status: string
  message: string
}
