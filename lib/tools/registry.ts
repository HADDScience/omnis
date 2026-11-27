// 도구 레지스트리 — 옴니스 도구를 어디에 어떻게 여는지 한 곳에 적는다.
//
// 도구 하나 = 한 줄. 이름 · 설명 · 입력 스키마 · 실행 함수는 MCP 정의(lib/omnis-mcp.ts OMNIS_TOOLS · IP_TOOLS · runTool)에
// 한 번만 있고, 여기에는 그 도구를 누구에게 어떻게 여는지(노출 · 위험 · 확인 · 권한)를 적는다.
// 노출 목록은 전부 여기서 나온다 — 손으로 따로 적던 세 목록을 없앴다:
//   MCP 서버            → mcp: true            (lib/omnis-mcp.ts TOOLS 와 시험이 맞춰 본다)
//   앱 AI(옴니스 대화방) → agent: "read" | "write"   (lib/agent/tools.ts AGENT_READ_TOOLS · AGENT_WRITE_TOOLS)
//   질문 경로(앱 「질문하기」 · MCP ask_omnis) → ask: "read" | "preview"   (lib/omnis-ask.ts ROUTE_READ_TOOLS · ROUTE_PREVIEW_TOOLS)
//
// 새 도구를 MCP 에 더하면 여기 한 줄을 더해야 tsc 가 지나간다(lib/omnis-mcp.ts 의 TOOL_POLICY 검사).
// 한쪽에만 여는 도구는 why 에 까닭을 적는다 — 시험(lib/tools/registry.test.ts)이 까닭 없는 예외를 막는다.
// 계획: mydocs/plans/2026-11-17-tool-registry.md
//
// 이 파일은 데이터만 둔다(prisma · 서버 모듈을 들이지 않는다) — 시험 · 화면 어디서든 읽을 수 있게.

/** 앱 AI 에서의 모양 — 읽기는 바로 돌고, 쓰기는 확인 카드를 띄우고 사용자가 확인한 뒤에 돈다 */
export type AgentExposure = "read" | "write" | false

/**
 * 질문 경로(확인 단계가 없다)에서의 모양.
 * read    — 그대로 연다
 * preview — 쓰기 도구를 「미리보기만」 으로 연다. confirm 칸을 지우고 늘 confirm 없이 부른다 → 쓰지 않고 남길 내용만 돌려준다.
 *           MCP 처럼 confirm 으로 확인하는 도구(confirm: "param")만 될 수 있다
 */
export type AskExposure = "read" | "preview" | false

export interface ToolPolicy {
  /** MCP 서버(hadd-omnis)에 연다 */
  mcp: boolean
  agent: AgentExposure
  ask: AskExposure
  /**
   * 쓰기 확인 방법.
   * card  — 앱 AI 의 확인 카드만(MCP 는 부르면 바로 쓴다 — 바깥 클라이언트가 사용자 확인을 맡는다)
   * param — MCP 도 confirm=true 가 있어야 쓴다(없으면 미리보기). 앱 AI 에서는 confirm 칸을 지우고 카드가 그 자리다
   */
  confirm?: "card" | "param"
  /** 지식재산권 구성원만(runTool 이 거절한다). 쓰기면 read_guide 확인 코드(guide)를 받는다 */
  ip?: boolean
  /** 앱 AI 에서 지우는 입력 — 모델이 쓰지 않을 칸 */
  agentDropProps?: string[]
  /** 한쪽에만 열거나 정의를 따로 두는 까닭 */
  why?: string
}

const R = { mcp: true, agent: "read", ask: "read" } as const satisfies ToolPolicy
/** 읽기지만 질문 경로에는 열지 않는다 — why 필수 */
const R_NO_ASK = (why: string) => ({ mcp: true, agent: "read", ask: false, why }) as const satisfies ToolPolicy
/** 쓰기 — MCP 는 바로, 앱 AI 는 확인 카드, 질문 경로에는 없다(확인 단계가 없어서) */
const W = { mcp: true, agent: "write", ask: false, confirm: "card" } as const satisfies ToolPolicy
/** CRM 쓰기 — confirm 으로 확인한다: MCP 는 confirm=true 일 때만 쓰고, 앱 AI 는 확인 카드, 질문 경로는 미리보기만 */
const CRM_W = { mcp: true, agent: "write", ask: "preview", confirm: "param", agentDropProps: ["confirm"] } as const satisfies ToolPolicy
/** 계획을 먼저 세우는 쓰기(#248, lib/tools/planned.ts) — CRM 쓰기와 같은 확인: MCP confirm=true · 앱 AI 확인 카드 · 질문 경로 미리보기 */
const PW = CRM_W

export const TOOL_POLICY = {
  // ─── MCP · 앱 AI · 질문 경로 공통 읽기 ───
  search_knowledge: { ...R, why: "앱 AI · 질문 경로는 각주 번호를 실행에 이어 붙여야 해 같은 검색을 그 경로 안에서 따로 정의한다(lib/agent/tools.ts · lib/omnis-ask.ts)" },
  list_tasks: R,
  get_task: R,
  read_file: R,
  list_notifications: R,
  home_suggestions: R,
  list_projects: R,
  list_members: R,
  crm_overview: R,
  find_org: R,
  // CRM 제품 · 재고 — record_sample 의 product_id 를 여기서 고른다
  list_products: R,
  // CRM 샘플요청 목록 — update_sample · delete_sample 의 sample_id 를 여기서 고른다
  list_samples: R,
  // 견적 · 받을 돈 목록 — update_quote · delete_quote 의 quote_id, record_payment 의 invoice_id
  list_quotes: R,
  list_receivables: R,
  // 생산 기록 목록 — update_production · delete_production 의 production_id
  list_productions: R,
  // 출고 목록 — update_shipment · delete_shipment 의 shipment_id
  list_shipments: R,
  list_omnis_cards: R,
  get_omnis_card: R,
  list_weekly_reports: R,
  list_chat: { ...R, why: "질문 경로에서는 방 보기(view=room)를 닫는다 — lib/omnis-ask.ts routeToolSchema" },
  company_profile: R,
  list_company_records: R,
  list_certifications: R,
  // 국가과제(2026-11-25) — 우리 결정 · 과제 후보 읽기, 인증 · 결정 고치기 · 후보 올리기
  list_grant_decisions: R,
  search_grant_notices: R,
  update_certification: PW,
  update_grant_decision: PW,
  add_grant_decision: PW,
  remove_grant_decision: PW,
  list_record_proposals: R,
  list_tax_invoices: R,
  list_staff: R,
  list_market_companies: R,
  get_context: R,
  list_calendar: R,

  list_rooms: R_NO_ASK("질문 경로의 답은 여러 사람이 볼 수 있는 자리에 붙어, 단톡 · 1:1 방은 다루지 않는다"),

  // ─── 지식재산권(구성원만) ───
  read_guide: { ...R_NO_ASK("질문 경로는 지식재산권을 ip_overview 한 장으로 본다"), ip: true },
  list_stages: { ...R_NO_ASK("질문 경로는 지식재산권을 ip_overview 한 장으로 본다"), ip: true },
  list_ip: { ...R_NO_ASK("질문 경로는 지식재산권을 ip_overview 한 장으로 본다"), ip: true },
  get_ip: { ...R_NO_ASK("질문 경로는 지식재산권을 ip_overview 한 장으로 본다"), ip: true },
  list_todo: { ...R_NO_ASK("질문 경로는 지식재산권을 ip_overview 한 장으로 본다"), ip: true },
  add_progress: { ...W, ip: true },
  correct_ip: { ...W, ip: true },
  create_ip: { ...W, ip: true },
  add_ip_image: { ...W, ip: true },

  // ─── 쓰기 ───
  create_task: W,
  update_task: W,
  update_checklist: W,
  post_message: W,
  write_omnis_card: W,
  save_company_record: W,
  write_weekly_report: { ...W, agentDropProps: ["draft"] },
  respond_notification: W,
  delete_company_record: W,
  decide_record_proposal: W,
  upload_file: W,
  // CRM 샘플 전달(#231) — 기관이 없으면 만들지 먼저 묻고, 재고까지 빠진다. 질문 경로에서는 미리보기만
  record_sample: { mcp: true, agent: "write", ask: "preview", confirm: "param", agentDropProps: ["confirm"] },
  // CRM 고치기 — record_sample 과 같은 방식(MCP confirm=true 일 때만 · 앱 AI 확인 카드 · 질문 경로 미리보기). lib/crm-write-rules.ts
  update_sample: CRM_W,
  delete_sample: CRM_W,
  create_org: CRM_W,
  update_org: CRM_W,
  record_stock: CRM_W,
  record_production: CRM_W,
  update_production: CRM_W,
  delete_production: CRM_W,
  create_quote: CRM_W,
  update_quote: CRM_W,
  delete_quote: CRM_W,
  record_shipment: CRM_W,
  update_shipment: CRM_W,
  delete_shipment: CRM_W,
  record_payment: CRM_W,

  // ─── 묶음 1(#248) 업무 · 프로젝트 · 채팅 방 · 알림 · 주간보고 — lib/tools/defs-work.ts ───
  list_task_products: R,
  list_activity: R,
  list_room_files: R_NO_ASK("질문 경로의 답은 여러 사람이 볼 수 있는 자리에 붙어, 단톡 · 1:1 방 서랍은 다루지 않는다"),
  create_project: PW,
  merge_projects: PW,
  manage_room: PW,
  manage_notifications: PW,
  set_notification_prefs: PW,
  delete_weekly_report: PW,

  // ─── 묶음 2(#248) CRM 나머지 — lib/tools/defs-crm.ts ───
  list_stock_moves: R,
  list_payments: R,
  list_inquiries: R,
  delete_stock_move: PW,
  delete_payment: PW,
  settle_payments: PW,
  create_contact: PW,
  decide_inquiry: PW,
  link_tax_invoice: PW,
  delete_tax_invoice: PW,
  import_tax_invoice: PW,

  // ─── 묶음 3(#248) 지식 카드 — lib/tools/defs-cards.ts ───
  omnis_card_history: R,
  list_card_proposals: R,
  list_bookmarks: R,
  list_my_questions: R_NO_ASK("질문 경로의 답은 여러 사람이 볼 수 있는 자리에 붙어, 한 사람의 질문 기록은 다루지 않는다"),
  delete_omnis_card: PW,
  manage_omnis_category: PW,
  restore_omnis_card: PW,
  decide_card_proposal: PW,
  manage_bookmarks: PW,

  // ─── 묶음 4(#248) 회사 · 캘린더 · 관리 설정 — lib/tools/defs-admin.ts. 관리자만인 것은 실행이 caller.role 을 본다 ───
  ai_budget: R_NO_ASK("관리자만 보는 설정 — 질문 경로의 답은 여러 사람이 볼 수 있는 자리에 붙는다"),
  list_feature_requests: R_NO_ASK("관리자만 보는 요청 목록(요청한 사람 이름 · 원문) — 질문 경로의 답은 여러 사람이 볼 수 있는 자리에 붙는다"),
  ai_survey_results: R_NO_ASK("관리자만 보는 설문 합계 — 질문 경로의 답은 여러 사람이 볼 수 있는 자리에 붙는다"),
  get_interview_pack: R_NO_ASK("채용 담당만 받는 지원자 면접자료 주소 — 질문 경로의 답은 여러 사람이 볼 수 있는 자리에 붙는다"),
  list_applications: R_NO_ASK("채용 담당만 보는 지원자 이름 — 질문 경로의 답은 여러 사람이 볼 수 있는 자리에 붙는다"),
  update_company_profile: PW,
  save_company_year: PW,
  delete_company_year: PW,
  set_calendar_audience: PW,
  set_ai_budget: PW,
  set_feature_status: PW,
  send_feedback: PW,
  change_application_stage: { ...PW, ask: false, why: "채용 담당만 바꾸는 지원자 단계 — 질문 경로의 미리보기도 여러 사람이 볼 수 있는 자리에 붙는다" },
  update_job_posting: { ...PW, ask: false, why: "채용 담당만 고치는 공고 면접 정보 — 질문 경로의 미리보기도 여러 사람이 볼 수 있는 자리에 붙는다" },

  // ─── 묶음 5(#248) 지식재산권 — lib/tools/defs-ip.ts. 지식재산권 화면에 들어가는 사람만(실행이 caller.ip 를 본다) ───
  ip_records: R_NO_ASK("질문 경로는 지식재산권을 ip_overview 한 장으로 본다"),
  ip_save_communication: PW,
  ip_save_action: PW,
  ip_progress_edit: PW,
  ip_image_edit: PW,

  // ─── 묶음 6(#248) 홈페이지 · 칼럼 — lib/tools/defs-website.ts. 홈페이지 관리 화면과 같은 권한(재직 구성원, 승인은 검토자) ───
  list_website_posts: R,
  website_stats: R,
  list_column_keywords: R,
  list_column_drafts: R,
  save_website_post: PW,
  delete_website_post: PW,
  arrange_website_posts: PW,
  upload_website_media: PW,
  collect_column_keywords: PW,
  column_keyword_action: PW,
  create_column_draft: PW,
  update_column_draft: PW,
  column_draft_action: PW,

  // ─── 묶음 7(#248) 파일 · NAS — lib/tools/defs-files.ts ───
  list_files: R_NO_ASK("내가 볼 수 있는 파일에는 나만 보는 파일 · 단톡방 첨부가 섞여, 여러 사람이 보는 질문 경로의 답에 붙이지 않는다"),
  browse_nas: R,
  link_nas_file: PW,

  // ─── MCP 에만 ───
  ask_omnis: { mcp: true, agent: false, ask: false, why: "앱 AI · 질문 경로가 곧 옴니스 — 같은 AI 를 다시 부르지 않는다" },
  create_upload_link: { mcp: true, agent: false, ask: false, why: "셸(curl)로 올리는 링크. 앱에서는 입력창에 파일을 붙인다. 링크가 곧 사용자 권한이라 대화 기록에 남기지 않는다" },

  // ─── 앱 AI 에만(정의는 그 경로 안에) ───
  ip_overview: { mcp: false, agent: "read", ask: "read", ip: true, why: "상표 · 특허 한 장 요약 — MCP 는 list_ip · get_ip 로 직접 본다. 정의는 lib/agent/tools.ts · lib/omnis-ask.ts" },
  draft_document: { mcp: false, agent: "write", ask: false, confirm: "card", why: "결과물(문서 초안) 카드 — 앱 화면에서만 보인다. lib/agent/outputs.ts" },
  create_file: { mcp: false, agent: "write", ask: false, confirm: "card", why: "결과물(파일) 카드 — 앱 화면에서만. MCP 는 upload_file. lib/agent/outputs.ts" },
  propose_records: { mcp: false, agent: "write", ask: false, confirm: "card", why: "기록 제안 카드 — 앱 화면에서만. MCP 는 save_company_record. lib/agent/outputs.ts" },
  request_feature: { mcp: false, agent: "write", ask: false, confirm: "card", why: "앱 AI 가 못 하는 일을 개발자에게 넘기는 카드 — MCP 클라이언트에는 자기 경로가 있다. lib/agent/outputs.ts" },
  // 작업용 컴퓨터 0단계(2026-11-26) — 켜진 사람(WORKBENCH_USER_IDS)에게만 보인다. lib/workbench/cards.ts
  start_workbench: { mcp: false, agent: "write", ask: false, confirm: "card", why: "작업용 컴퓨터(Claude Managed Agents)로 넘기는 카드 — 결과가 이 방에 붙어 앱 화면에서만. MCP 클라이언트는 그 자체가 작업용 컴퓨터다" },
  continue_workbench: { mcp: false, agent: "write", ask: false, confirm: "card", why: "작업용 컴퓨터 상한 뒤 이어 가기 카드 — start_workbench 와 같은 까닭" },
  stop_workbench: { mcp: false, agent: "write", ask: false, confirm: "card", why: "작업용 컴퓨터 멈춤 카드 — start_workbench 와 같은 까닭" },
} as const satisfies Record<string, ToolPolicy>

export type ToolName = keyof typeof TOOL_POLICY

const entries = Object.entries(TOOL_POLICY) as [ToolName, ToolPolicy][]
const names = (pick: (p: ToolPolicy) => boolean) => entries.filter(([, p]) => pick(p)).map(([n]) => n)

/** MCP 서버가 여는 도구 이름 */
export const MCP_TOOL_NAMES: readonly string[] = names((p) => p.mcp)
/** 앱 AI 읽기 · 쓰기 */
export const AGENT_READ_NAMES: readonly string[] = names((p) => p.agent === "read")
export const AGENT_WRITE_NAMES: readonly string[] = names((p) => p.agent === "write")
/** 질문 경로 — 읽기 · 미리보기 */
export const ASK_READ_NAMES: readonly string[] = names((p) => p.ask === "read")
export const ASK_PREVIEW_NAMES: readonly string[] = names((p) => p.ask === "preview")
/** 지식재산권 쓰기 — 앱 AI 에서 guide 확인 코드 칸을 남긴다 */
export const IP_WRITE_NAMES: readonly string[] = names((p) => !!p.ip && p.agent === "write")

export function toolPolicy(name: string): ToolPolicy | undefined {
  return (TOOL_POLICY as Record<string, ToolPolicy>)[name]
}
