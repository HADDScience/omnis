// 에이전트 지표 — wk-agent · native · route 가 같은 식으로 센다 (report.ts 의 Agentic 표).
import type { MethodResult } from "../methods"

export interface AgentStats {
  /** 모델 호출 수 (한도 도달 뒤 마지막 답 호출 포함) */
  iterations: number
  toolCalls: number
  /** 서로 다른 도구 이름 수 */
  toolKinds: number
  /** 검색류 도구를 뒤 단계에서 다른 인자로 다시 불렀나 — "첫 검색이 빗나가 질의를 바꿔 다시 찾음" 의 근사 */
  requery: boolean
  hitLimit: boolean
  /** 컨텍스트 압축 횟수 (wk-agent 만. 나머지는 0) */
  compactions: number
}

/** 결과를 찾는 도구. read_document · get_task 처럼 "다른 문서를 읽는" 도구는 재검색으로 세지 않는다 */
const SEARCH_TOOLS = new Set(["search_knowledge", "grep_chunks", "list_documents", "list_tasks", "find_org", "list_omnis_cards", "list_company_records", "get_context", "list_chat", "list_market_companies"])

export function agentStats(trace: NonNullable<MethodResult["trace"]>, iterations: number, hitLimit: boolean, compactions = 0): AgentStats {
  const key = (a: Record<string, unknown>) => JSON.stringify(a)
  const requery = trace.some((t) => SEARCH_TOOLS.has(t.tool) && trace.some((s) => s.step < t.step && s.tool === t.tool && key(s.args) !== key(t.args)))
  return { iterations, toolCalls: trace.length, toolKinds: new Set(trace.map((t) => t.tool)).size, requery, hitLimit, compactions }
}
