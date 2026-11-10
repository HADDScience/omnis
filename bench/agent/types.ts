// 에이전트형 과제 벤치의 공용 타입 — 과제 파일 형식 · 턴 기록 · 결과 한 줄.
//
// 과제 파일은 사내 데이터가 들어가 저장소 밖(~/work/omnis-import/eval/agent-tasks-*.json)에 둔다.
// 형식 예시는 bench/agent/tasks.example.json.
import type { Usage } from "../providers"
import type { RouterDecision } from "./router"

/** 과제 유형. 리포트가 유형별로 나눠 센다 */
export type TaskKind =
  | "aggregate" //  (a) 여러 도구를 거쳐 집계·요약
  | "write" //      (b) 업무 생성·수정·지시 제안
  | "draft" //      (c) 문서 초안
  | "file" //       (d) 파일 생성 제안
  | "knowledge" //  (e) 대화 → 지식·기록 정리 제안
  | "clarify" //    (f) 모호하거나 하면 안 되는 요청 — 되묻기·거절

/** 난이도 등급 — 채점·리포트용. 라우터(Jev)에 절대 넘기지 않는다 */
export type TaskLevel = "L0" | "L1" | "L2" | "L3"
export const LEVEL_LABEL: Record<TaskLevel, string> = {
  L0: "L0 아주 간단",
  L1: "L1 단일 행동",
  L2: "L2 조회 조합",
  L3: "L3 복잡",
}
export type TaskSplit = "dev" | "test"

export const KIND_LABEL: Record<TaskKind, string> = {
  aggregate: "a 집계",
  write: "b 업무 제안",
  draft: "c 문서 초안",
  file: "d 파일 생성",
  knowledge: "e 지식 정리",
  clarify: "f 되묻기·거절",
}

/**
 * 인자 하나에 거는 조건. 여러 개를 주면 모두 맞아야 한다.
 * 문자열 비교는 값을 글자로 바꿔서 한다 — 배열·객체는 JSON 으로.
 */
export interface ArgCond {
  equals?: string | number | boolean
  contains?: string
  notContains?: string
  /** 값이 배열이고, 그 원소 중 하나가 이 글자를 포함 */
  includes?: string
  regex?: string
  exists?: boolean
  absent?: boolean
  oneOf?: (string | number | boolean)[]
  /** 이 중 하나라도 맞으면 */
  anyOf?: ArgCond[]
}

/** 기대하는(또는 금지하는) 쓰기 제안. args 의 키 "$json" 은 인자 전체를 JSON 으로 본 것 */
export interface ProposalSpec {
  /** 도구 이름. 배열이면 그중 하나. "*" 는 아무 쓰기 도구 */
  tool: string | string[]
  args?: Record<string, ArgCond>
  note?: string
}

export interface AgentTask {
  id: string
  kind: TaskKind
  /** 난이도. 라우터에 넘기지 않는다 */
  level?: TaskLevel
  /** 라우터 기준을 고르는 묶음(dev)과 검증하는 묶음(test) */
  split?: TaskSplit
  /** 사용자가 옴니스에게 하는 말 */
  prompt: string
  /** 심판에게 주는 정답 설명 — DB 를 조회해 확인한 사실을 적는다 */
  rubric: string
  /** 최종 답 + 제안 인자에 들어 있어야 하는 글자 */
  expect?: string[]
  /** expect 중 몇 개 맞으면 통과인가. 기본 전부 */
  minHits?: number
  /** 최종 답 + 제안 인자에 있으면 안 되는 글자 (범위 밖 항목 · 섞으면 안 되는 합계 · 개인정보 …) */
  mustNotContain?: string[]
  /** 최종 답에 이 중 하나는 있어야 한다 (되묻기 "?" 같은 것) */
  answerAnyOf?: string[]
  /** 반드시 맞아야 하는 쓰기 제안 */
  proposals?: ProposalSpec[]
  /** 기대 밖이어도 감점하지 않는 쓰기 도구 */
  allowExtra?: string[]
  /** 하나라도 맞으면 위반인 제안 */
  forbidProposals?: ProposalSpec[]
  /** 부르기만 해도 위반인 도구 */
  forbidTools?: string[]
  /** 반드시 불러야 하는 도구 (중복 확인 같은 것) */
  requiredTools?: string[]
  /**
   * dry-run 용 정답 스크립트. 1턴 reads → 2턴 proposals → 3턴 answer.
   * 사람이 DB 를 보고 쓴 모범 풀이이기도 하다.
   */
  dry: {
    reads: [string, Record<string, unknown>][]
    proposals?: [string, Record<string, unknown>][]
    answer: string
  }
}

export interface TaskFile {
  /** 과제를 만든 로컬 스냅샷 날짜. 정답(지연·마감 임박)이 이 날짜에 묶인다 */
  snapshotDate: string
  /** 질문하는 사람 (정식 이름) */
  user: string
  /** dev/test 를 나눈 방법과 시드 */
  splitRule?: { seed: number; method: string }
  tasks: AgentTask[]
}

/** 벤더 중립 사용량. cacheWrite 는 Anthropic 캐시 쓰기(입력 단가 1.25배)라 따로 센다 */
export interface AgentUsage extends Usage {
  cacheWrite: number
}

export const ZERO_AGENT_USAGE: AgentUsage = { input: 0, output: 0, thinking: 0, cached: 0, cacheWrite: 0 }

export function addAgentUsage(a: AgentUsage, b: AgentUsage): AgentUsage {
  return {
    input: a.input + b.input, output: a.output + b.output, thinking: a.thinking + b.thinking,
    cached: a.cached + b.cached, cacheWrite: a.cacheWrite + b.cacheWrite,
  }
}

export type CallKind = "read" | "proposal" | "rejected" | "blocked" | "error"

export interface CallRecord {
  name: string
  args: Record<string, unknown>
  kind: CallKind
  resultChars: number
  ms: number
}

export interface TurnRecord {
  turn: number
  ms: number
  usage: AgentUsage
  /** 보낸 요청(시스템 + 도구 + 대화)의 추정 토큰. 실제 사용량과 견주어 추산식을 고친다 */
  estInput: number
  estOutput: number
  stop?: string
  text: string
  calls: CallRecord[]
}

export interface Proposal {
  seq: number
  turn: number
  tool: string
  args: Record<string, unknown>
  /** 제품이 받지 않았을 인자면 이유. 채점에서 제안으로 치지 않는다 */
  rejected?: string
}

export interface DetGrade {
  hits: string[]
  hitTotal: number
  minHits: number
  /** 기대 제안 중 맞춘 것 (proposals 의 인덱스) */
  matched: number[]
  expectedProposals: number
  /** 받아들여진 제안 중 기대에도 allowExtra 에도 없는 것 */
  extra: number
  violations: string[]
  pass: boolean
}

export interface JudgeGrade {
  score: 0 | 1 | 2
  /** 잘못된 쓰기(엉뚱한 담당·마감 · 확인 없이 실행했다고 말함 · 하면 안 되는 쓰기) */
  badWrite: boolean
  reason: string
  costUsd: number
  ms: number
}

export interface AgentRow {
  runId: string
  /** 라우터 모드면 가상 모델 이름 (예: router:jev(luna/sol)) */
  model: string
  /** 실제로 돈 모델 ID. 라우터 모드면 고른 모델 */
  modelId: string
  taskId: string
  kind: TaskKind
  level?: TaskLevel
  split?: TaskSplit
  rep: number
  prompt: string
  answer: string
  proposals: Proposal[]
  turns: TurnRecord[]
  usage: AgentUsage
  /** 라우터 모드면 Jev 호출 몫을 포함한다 */
  costUsd: number
  costKrw: number
  /** 라우터 모드면 Jev 호출 지연을 포함한다 */
  ms: number
  det: DetGrade
  judge: JudgeGrade | null
  /** 심판 프롬프트 추정 토큰 (dry-run 은 보내지 않고 크기만 잰다) */
  judgeEstInput: number
  completed: boolean
  /** 라우터 모드만: Jev 결정 · 확신도 · 고른 모델 · Jev 토큰·비용·지연 */
  router?: RouterDecision
  error?: string
  note?: string
  at: string
}
