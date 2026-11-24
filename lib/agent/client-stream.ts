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
  list_products: "CRM 제품 목록",
  record_sample: "샘플 전달 기록",
  list_samples: "CRM 샘플요청 목록",
  update_sample: "샘플 기록 고치기",
  delete_sample: "샘플 기록 지우기",
  create_org: "CRM 기관 만들기",
  update_org: "CRM 기관 고치기",
  record_stock: "재고 입고 · 조정",
  record_production: "생산 기록",
  list_quotes: "CRM 견적 목록",
  list_receivables: "받을 돈 목록",
  create_quote: "견적 만들기",
  update_quote: "견적 고치기",
  delete_quote: "견적 지우기",
  record_shipment: "출하 기록",
  record_payment: "입금 기록",
  list_task_products: "업무용 제품 보는 중",
  list_activity: "활동 기록 보는 중",
  list_room_files: "방 서랍 보는 중",
  create_project: "프로젝트 만들기",
  merge_projects: "프로젝트 합치기",
  manage_room: "대화방 설정",
  manage_notifications: "알림 정리",
  set_notification_prefs: "기기 알림 설정",
  delete_weekly_report: "주간보고 지우기",
  list_stock_moves: "재고 장부 보는 중",
  list_payments: "입금 기록 보는 중",
  list_inquiries: "홈페이지 문의 보는 중",
  update_shipment: "출고 고치기",
  delete_shipment: "출고 지우기",
  delete_stock_move: "재고 장부 줄 지우기",
  delete_payment: "입금 기록 지우기",
  settle_payments: "받음으로 표시",
  create_contact: "담당자 추가",
  decide_inquiry: "홈페이지 문의 처리",
  link_tax_invoice: "세금계산서 ↔ 견적",
  delete_tax_invoice: "세금계산서 지우기",
  import_tax_invoice: "세금계산서 올리기",
  omnis_card_history: "카드 이력 보는 중",
  list_card_proposals: "카드 제안 보는 중",
  list_bookmarks: "즐겨찾기 보는 중",
  list_my_questions: "내 질문 기록 보는 중",
  delete_omnis_card: "지식 카드 지우기",
  manage_omnis_category: "카드 분류",
  restore_omnis_card: "카드 되돌리기",
  decide_card_proposal: "카드 제안 처리",
  manage_bookmarks: "즐겨찾기",
  ai_budget: "AI 비용 상한 보는 중",
  list_feature_requests: "기능 요청 보는 중",
  ai_survey_results: "설문 합계 보는 중",
  list_applications: "지원서함 보는 중",
  update_company_profile: "회사 정보 고치기",
  save_company_year: "연도별 재무",
  delete_company_year: "연도별 재무 지우기",
  set_calendar_audience: "캘린더 공개 범위",
  set_ai_budget: "AI 비용 상한 바꾸기",
  set_feature_status: "기능 요청 상태",
  send_feedback: "문의 · 의견 보내기",
  ip_records: "지식재산권 기록 보는 중",
  ip_save_communication: "지식재산권 연락 기록",
  ip_save_action: "지식재산권 액션",
  ip_progress_edit: "진행 기록 고치기",
  ip_image_edit: "지식재산권 이미지",
  list_website_posts: "홈페이지 기사 보는 중",
  website_stats: "홈페이지 방문 통계",
  list_column_keywords: "칼럼 키워드 보는 중",
  list_column_drafts: "칼럼 초안 보는 중",
  save_website_post: "홈페이지 기사 저장",
  delete_website_post: "홈페이지 기사 지우기",
  arrange_website_posts: "홈페이지 기사 정리",
  upload_website_media: "홈페이지 사진 올리기",
  collect_column_keywords: "칼럼 키워드 모으기",
  column_keyword_action: "칼럼 키워드",
  create_column_draft: "칼럼 초안 쓰기",
  update_column_draft: "칼럼 초안 고치기",
  column_draft_action: "칼럼 초안",
  list_files: "파일 보는 중",
  browse_nas: "NAS 보는 중",
  link_nas_file: "NAS 파일 잇기",
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
  list_calendar: "웍스 일정",
  list_stages: "지식재산권 상태·사건",
  list_ip: "지식재산권 목록",
  get_ip: "지식재산권 상세",
  list_todo: "지식재산권 할 일",
  read_guide: "지식재산권 기록 지침",
  read_file: "첨부 읽기",
  list_rooms: "내 대화방",
  create_task: "업무 만들기 제안",
  update_task: "업무 고치기 제안",
  update_checklist: "체크리스트 제안",
  post_message: "글 올리기 제안",
  write_omnis_card: "지식 카드 제안",
  save_company_record: "회사 기록 제안",
  write_weekly_report: "주간보고 초안",
  draft_document: "문서 초안",
  create_file: "파일 만들기 제안",
  propose_records: "연혁 제안",
  respond_notification: "알림 응답 제안",
  delete_company_record: "회사 기록 지우기 제안",
  decide_record_proposal: "연혁 후보 판단 제안",
  upload_file: "파일 올리기 제안",
  add_progress: "지식재산권 기록 제안",
  correct_ip: "지식재산권 정정 제안",
  create_ip: "지식재산권 새 건 제안",
  add_ip_image: "지식재산권 이미지 걸기 제안",
  request_feature: "기능 요청 전달 제안",
}
