// 브라우저 — 에이전트 스트림(AI SDK UI message stream, SSE)을 읽어 「지금 쓰는 답」 과 「도는 도구」 로 접는다.
// 순수 접기(foldChunk)는 시험한다: lib/agent/client-stream.test.ts
//
// useChat 을 쓰지 않는 이유: 방의 글 · 확인 카드는 DB 가 원본이고(새로고침 · 재접속), 스트림은 그 사이를 채우는
// 미리보기일 뿐이다. 스트림이 끝나면 화면은 방 상태(GET /api/agent/rooms/[id])를 다시 읽어 갈아 끼운다.

import { summarizeInput, summarizeOutput } from "./tool-trail"

export interface LiveTool {
  id: string
  name: string
  state: "running" | "done" | "approval" | "error"
  /** 인자 · 결과 요약 — 끝난 뒤 DB 에서 다시 그리는 것(lib/agent/tool-trail.ts)과 같은 모양 */
  input?: string
  result?: string
}

export interface LiveAnswer {
  /** 끝난 단계들의 글 */
  done: string[]
  /** 지금 단계에서 쓰는 중인 글 */
  current: string
  tools: LiveTool[]
  error: string | null
}

export const EMPTY_LIVE: LiveAnswer = { done: [], current: "", tools: [], error: null }

type Chunk = { type: string; [k: string]: unknown }

export function foldChunk(live: LiveAnswer, c: Chunk): LiveAnswer {
  switch (c.type) {
    case "start-step":
      return live.current ? { ...live, done: [...live.done, live.current], current: "" } : live
    case "reset-step":
      // 재시도 — 이 단계에서 쓰던 글은 버린다
      return { ...live, current: "" }
    case "text-delta":
      return { ...live, current: live.current + String(c.delta ?? "") }
    case "tool-input-start":
      if (live.tools.some((t) => t.id === c.toolCallId)) return live
      return { ...live, tools: [...live.tools, { id: String(c.toolCallId), name: String(c.toolName), state: "running" }] }
    case "tool-input-available":
      return { ...live, tools: live.tools.map((t) => (t.id === c.toolCallId ? { ...t, input: summarizeInput(c.input) } : t)) }
    case "tool-output-available":
      return { ...live, tools: live.tools.map((t) => (t.id === c.toolCallId ? { ...t, state: "done", result: summarizeOutput(c.output).text } : t)) }
    case "tool-output-error":
      return { ...live, tools: live.tools.map((t) => (t.id === c.toolCallId ? { ...t, state: "error", result: String(c.errorText ?? "") } : t)) }
    case "tool-approval-request":
      return { ...live, tools: live.tools.map((t) => (t.id === c.toolCallId ? { ...t, state: "approval", result: "확인 카드" } : t)) }
    case "error":
      return { ...live, error: String(c.errorText ?? "답을 만들지 못했습니다") }
    default:
      return live
  }
}

export const liveText = (l: LiveAnswer) => [...l.done, l.current].map((t) => t.trim()).filter(Boolean).join("\n\n")

/** SSE 본문을 끝까지 읽으며 덩어리마다 onChunk */
export async function readAgentStream(res: Response, onChunk: (c: Chunk) => void): Promise<void> {
  if (!res.body) return
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buf = ""
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += value
    let i: number
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const event = buf.slice(0, i)
      buf = buf.slice(i + 2)
      for (const line of event.split("\n")) {
        if (!line.startsWith("data:")) continue
        const data = line.slice(5).trim()
        if (!data || data === "[DONE]") continue
        try {
          onChunk(JSON.parse(data) as Chunk)
        } catch {
          // 한 줄이 깨져도 나머지는 읽는다
        }
      }
    }
  }
}

/** 도구 이름 → 화면 글 */
export const TOOL_LABEL: Record<string, string> = {
  search_knowledge: "사내 자료 검색",
  ip_overview: "지식재산권 현황",
  list_tasks: "업무 목록",
  get_task: "업무 상세",
  list_projects: "프로젝트 목록",
  list_members: "구성원 목록",
  crm_overview: "CRM 현황",
  find_org: "거래 기관",
  list_omnis_cards: "지식 카드 목록",
  get_omnis_card: "지식 카드",
  list_weekly_reports: "주간보고",
  list_chat: "채팅",
  list_notifications: "알림",
  company_profile: "회사 정보",
  list_company_records: "회사 기록",
  list_record_proposals: "기록 제안",
  list_tax_invoices: "세금계산서",
  list_staff: "인력",
  list_market_companies: "경쟁사",
  get_context: "연결된 자료",
  list_stages: "지식재산권 단계",
  list_ip: "지식재산권 목록",
  get_ip: "지식재산권 상세",
  list_todo: "지식재산권 할 일",
  create_task: "업무 만들기 제안",
  update_task: "업무 고치기 제안",
  update_checklist: "체크리스트 제안",
  post_message: "업무방 글 제안",
  write_omnis_card: "지식 카드 제안",
  save_company_record: "회사 기록 제안",
}
