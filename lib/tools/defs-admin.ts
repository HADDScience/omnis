// 묶음 4(#248) — 회사 정보 · 연도별 재무 · 웍스 캘린더 공개 범위 · AI 비용 상한 · 기능 요청 · AI 설문 합계 도구 정의. 데이터만 둔다.
// 화면에서 관리자만 하는 일은 도구도 관리자만 된다(실행 lib/tools/plan-admin.ts 가 caller.role 을 본다).
import { CONFIRM_PROP } from "./planned"

const TEXT = { type: "string" } as const
const MONEY = { type: "string", description: "원. 숫자(쉼표 가능). 빈 문자열이면 지운다" } as const

export const ADMIN_TOOLS = [
  // ─── 읽기 ───
  {
    name: "ai_budget",
    description: "AI 비용 상한(사람별 하루 · 회사 월)과 사람별 예외, 기능 요청 · 비용 알림 받는 사람 — 관리자만. 화면 마이 › AI 비용 상한과 같다.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_feature_requests",
    description: "앱에 들어온 기능 요청 · 문의 목록(새로 · 검토 먼저) — 관리자만. set_feature_status 의 request 를 여기서 고른다.",
    inputSchema: { type: "object", properties: { status: { type: "string", enum: ["NEW", "REVIEW", "DONE", "ALL"], description: "기본 ALL" } } },
  },
  {
    name: "ai_survey_results",
    description: "AI 활용 설문 합계 — 관리자만. 이름 · 사람별 원문은 없다(화면과 같다).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_applications",
    description: [
      "홈페이지 채용 지원서함 — 채용 담당만(관리자라도 담당이 아니면 거절). 화면 채용 › 지원서함과 같은 목록이다.",
      "공고별 · 단계별 건수와 지원서마다 접수 번호 · 공고 · 단계 · 이름 · 학과 · 학년 · 접수일을 준다.",
      "연락처 · 이메일 · 지원 동기 · 이력서 파일은 주지 않는다 — 화면에서 본다.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        job: { type: "string", description: "공고 slug 로 좁히기(선택)" },
        stage: { type: "string", enum: ["RECEIVED", "SCREENING", "INTERVIEW", "OFFERED", "REJECTED", "WITHDRAWN", "HIRED"], description: "단계로 좁히기(선택)" },
      },
    },
  },

  // ─── 쓰기(계획 → 확인) ───
  {
    name: "update_company_profile",
    description: "회사 기본정보를 고친다 — 관리자만, 화면 회사 정보와 같다. 준 칸만 바뀐다(빈 문자열이면 그 칸을 지운다). 지금 값은 company_profile.",
    inputSchema: {
      type: "object",
      properties: {
        name_ko: TEXT, name_en: TEXT, biz_reg_no: { type: "string", description: "000-00-00000" }, biz_type: TEXT,
        corp_reg_no: { type: "string", description: "000000-0000000" }, industry: TEXT, industry_code: TEXT,
        founded_on: { type: "string", description: "YYYY-MM-DD" }, homepage: TEXT, hq_address: TEXT, lab_address: TEXT,
        partner_address: TEXT, as_of_date: { type: "string", description: "기준일 YYYY-MM-DD" },
        confirm: CONFIRM_PROP,
      },
    },
  },
  {
    name: "save_company_year",
    description: [
      "연도별 재무 한 줄(연도 + 단계)을 만들거나 고친다 — 관리자만, 화면 회사 정보 › 연도별과 같다.",
      "basis 는 CONFIRMED(확정) · PLANNED(계획). 그 연도 · 단계 줄이 있으면 준 칸만 바꾸고, 없으면 새로 만든다. 확정 · 계획을 섞어 적지 않는다.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        year: { type: "integer" }, basis: { type: "string", enum: ["CONFIRMED", "PLANNED"] },
        revenue_krw: MONEY, revenue_product_krw: MONEY, revenue_service_krw: MONEY, cost_of_sales_krw: MONEY,
        net_income_krw: MONEY, assets_krw: MONEY, liabilities_krw: MONEY, equity_krw: MONEY,
        headcount: { type: "string", description: "상시근로자 수. 빈 문자열이면 지운다" },
        account_label: TEXT, note: TEXT, as_of_date: { type: "string", description: "기준일 YYYY-MM-DD" },
        confirm: CONFIRM_PROP,
      },
      required: ["year", "basis"],
    },
  },
  {
    name: "delete_company_year",
    description: "연도별 재무 한 줄(연도 + 단계)을 지운다 — 관리자만.",
    inputSchema: {
      type: "object",
      properties: { year: { type: "integer" }, basis: { type: "string", enum: ["CONFIRMED", "PLANNED"] }, confirm: CONFIRM_PROP },
      required: ["year", "basis"],
    },
  },
  {
    name: "set_calendar_audience",
    description: "웍스 캘린더를 구성원 전체에 보일지(ALL) 관리자만 볼지(ADMIN) 정한다 — 관리자만, 화면 캘린더 설정과 같다. calendar 는 캘린더 ID 또는 이름.",
    inputSchema: {
      type: "object",
      properties: { calendar: TEXT, audience: { type: "string", enum: ["ALL", "ADMIN"] }, confirm: CONFIRM_PROP },
      required: ["calendar", "audience"],
    },
  },
  {
    name: "set_ai_budget",
    description: [
      "AI 비용 상한을 바꾼다 — 관리자만, 화면 마이 › AI 비용 상한과 같다(바로 적용).",
      "user_daily_krw(사람마다 하루) · monthly_krw(회사 월) · users(사람별 하루 예외 — { 정식 이름: 원 }, 0 이면 예외를 지운다) · recipients(알림 받는 사람 정식 이름들). 준 것만 바뀐다.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        user_daily_krw: { type: "integer" }, monthly_krw: { type: "integer" },
        users: { type: "object", additionalProperties: { type: "integer" } },
        recipients: { type: "array", items: { type: "string" } },
        confirm: CONFIRM_PROP,
      },
    },
  },
  {
    name: "set_feature_status",
    description: "기능 요청의 상태를 NEW(새로) · REVIEW(검토) · DONE(완료)로 바꾼다 — 관리자만. 완료로 바꿀 때 notice_change · notice_link 를 주면 요청한 사람들에게 알림이 간다(화면과 같다).",
    inputSchema: {
      type: "object",
      properties: {
        request: { type: "string", description: "요청 ID(list_feature_requests)" },
        status: { type: "string", enum: ["NEW", "REVIEW", "DONE"] },
        notice_change: { type: "string", description: "완료 알림 — 무엇이 바뀌었는지 한 줄" },
        notice_link: { type: "string", description: "완료 알림 — 바로 써 볼 옴니스 안의 주소(/ 로 시작, 예: /crm)" },
        confirm: CONFIRM_PROP,
      },
      required: ["request", "status"],
    },
  },
  {
    name: "send_feedback",
    description: "개발자에게 문의 · 의견 · 기능 요청을 보낸다 — 앱 정보의 「문의 · 의견 보내기」 와 같다. 사용자가 한 말을 옮긴다. reply_to 에 완료 알림을 받은 요청 ID 를 주면 그 요청에 답장한다.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["bug", "idea", "question"], description: "오류 · 제안 · 질문" },
        text: { type: "string" },
        reply_to: { type: "string", description: "답장할 요청 ID(완료 알림에서)" },
        confirm: CONFIRM_PROP,
      },
      required: ["text"],
    },
  },
] as const

export const ADMIN_READ_NAMES = ["ai_budget", "list_feature_requests", "ai_survey_results", "list_applications"] as const
export type AdminReadName = (typeof ADMIN_READ_NAMES)[number]
export type AdminWriteName = Exclude<(typeof ADMIN_TOOLS)[number]["name"], AdminReadName>
