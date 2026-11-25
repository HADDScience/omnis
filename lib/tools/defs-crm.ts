// 묶음 2(#248) — CRM 나머지(출고 · 재고 장부 · 입금 · 담당자 · 홈페이지 문의 · 세금계산서) 도구 정의. 데이터만 둔다.
// 실행은 lib/tools/plan-crm.ts. 쓰기는 계획을 먼저 세운다(lib/tools/planned.ts) — MCP 는 confirm=true 일 때만 쓴다.
import { CONFIRM_PROP } from "./planned"

export const CRM_MORE_TOOLS = [
  // ─── 읽기 ───
  {
    name: "list_stock_moves",
    description: "CRM 재고 장부 줄 — 입고 · 출고 · 실사 보정 · 생산. 화면 CRM › 재고의 장부와 같다. delete_stock_move 의 move_id 를 여기서 고른다. product 는 제품 ID · 코드 · 이름 일부(list_products).",
    inputSchema: {
      type: "object",
      properties: {
        product: { type: "string", description: "제품 ID · 코드 · 이름 일부. 비우면 전체" },
        limit: { type: "integer", description: "기본 30, 최대 100" },
      },
    },
  },
  {
    name: "list_payments",
    description: "세금계산서 한 장의 입금 · 출금 줄. delete_payment 의 payment_id 를 여기서 고른다. invoice_id 는 list_receivables 에서.",
    inputSchema: { type: "object", properties: { invoice_id: { type: "string" } }, required: ["invoice_id"] },
  },
  {
    name: "list_inquiries",
    description: "홈페이지 문의함 — 화면 CRM › 문의와 같다. decide_inquiry 의 inquiry_id 를 여기서 고른다. status 기본 NEW(검토 대기).",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["NEW", "ACCEPTED", "REJECTED", "SPAM", "ALL"] },
        limit: { type: "integer", description: "기본 20, 최대 100" },
      },
    },
  },

  // ─── 쓰기(계획 → 확인) ───
  {
    name: "delete_stock_move",
    description: "재고 장부 한 줄(직접 적은 입고 · 폐기 · 실사)을 지운다. 생산 · 출고에서 나온 줄은 그 기록을 지워야 한다. move_id 는 list_stock_moves 에서.",
    inputSchema: { type: "object", properties: { move_id: { type: "string" }, confirm: CONFIRM_PROP }, required: ["move_id"] },
  },
  {
    name: "delete_payment",
    description: "잘못 적은 입금 · 출금 한 줄을 지운다 — 화면 CRM › 입금과 같다. 받을 돈이 다시 늘어난다. payment_id 는 list_payments 에서.",
    inputSchema: { type: "object", properties: { payment_id: { type: "string" }, confirm: CONFIRM_PROP }, required: ["payment_id"] },
  },
  {
    name: "settle_payments",
    description: [
      "입금 기록을 쓰기 전에 이미 받은 매출 세금계산서를 한 번에 「받음」 으로 표시한다(화면의 시작 전 정리).",
      "입금일은 지어 넣지 않는다 — 발행일로 두고 「실제 입금일 모름」 메모를 남긴다. invoice_ids 는 list_receivables 에서.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: { invoice_ids: { type: "array", items: { type: "string" } }, confirm: CONFIRM_PROP },
      required: ["invoice_ids"],
    },
  },
  {
    name: "create_contact",
    description: "기관에 담당자를 더한다 — 화면 기관 상세의 담당자 추가와 같다. org 는 org_id 또는 기관 코드(find_org).",
    inputSchema: {
      type: "object",
      properties: {
        org: { type: "string", description: "org_id 또는 기관 코드(ORG…)" },
        name: { type: "string" },
        title: { type: "string", description: "직함" },
        phone: { type: "string" },
        email: { type: "string" },
        note: { type: "string" },
        confirm: CONFIRM_PROP,
      },
      required: ["org", "name"],
    },
  },
  {
    name: "decide_inquiry",
    description: [
      "홈페이지 문의를 처리한다 — 화면 CRM › 문의와 같다. 검토 대기(NEW) 문의만 된다.",
      "action=accept: 기관(org, 필수)과 담당자(contact, 선택)에 잇고 outcome 대로 빈 견적(quote) · 샘플요청(sample)을 만들거나 잇기만(none).",
      "기관이 없으면 create_org 로 먼저 만든다. action=reject 는 반려, spam 은 스팸 — CRM 은 건드리지 않는다.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        inquiry_id: { type: "string" },
        action: { type: "string", enum: ["accept", "reject", "spam"] },
        org: { type: "string", description: "accept — org_id 또는 기관 코드" },
        contact: { type: "string", description: "accept — contact_id(find_org)" },
        outcome: { type: "string", enum: ["quote", "sample", "none"], description: "accept — 무엇을 만들까" },
        note: { type: "string", description: "검토 메모" },
        confirm: CONFIRM_PROP,
      },
      required: ["inquiry_id", "action"],
    },
  },
  {
    name: "link_tax_invoice",
    description: "매출 세금계산서를 견적에 잇거나(quote_id) 끊는다(quote_id 빈 문자열) — 화면 견적 상세와 같다. 이으면 견적의 세금계산서 발행일이 비어 있을 때 채운다.",
    inputSchema: {
      type: "object",
      properties: { invoice_id: { type: "string" }, quote_id: { type: "string", description: "list_quotes 의 quote_id. 빈 문자열이면 끊기" }, confirm: CONFIRM_PROP },
      required: ["invoice_id", "quote_id"],
    },
  },
  {
    name: "delete_tax_invoice",
    description: "세금계산서 한 장을 지운다 — 잘못 올렸거나 취소 뒤 새로 발행한 경우. 그 장의 입금 기록도 함께 지워진다. 원본 PDF 는 NAS 에 남는다. 수정세금계산서는 지우지 말고 취소 · 재발행 장을 올린다.",
    inputSchema: { type: "object", properties: { invoice_id: { type: "string" }, confirm: CONFIRM_PROP }, required: ["invoice_id"] },
  },
  {
    name: "import_tax_invoice",
    description: [
      "세금계산서를 올린다 — 화면 CRM › 세금계산서 가져오기와 같다. 파일은 upload_file 로 먼저 올리고 그 파일 ID 를 준다.",
      "홈택스 목록 엑셀은 여러 장, PDF · 사진은 한 장. 기관 · 견적은 화면과 같은 규칙으로 잇는다(없는 기관은 새로 만든다).",
      "AI 가 읽은 사진 · 스캔은 accept_vision=true(원본과 대조했다)가 있어야 저장한다. 같은 날 · 거래처 · 합계가 이미 있으면 twin_is_different=true 로 다른 건임을 밝힌다.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "파일 ID(upload_file)" },
        accept_vision: { type: "boolean", description: "AI 판독 결과를 원본과 대조했다" },
        twin_is_different: { type: "boolean", description: "같은 날 · 거래처 · 합계가 있어도 다른 건이다" },
        keep_original: { type: "boolean", description: "이미 수정 발행된 건의 당초 장도 넣는다(취소 장도 함께 넣을 때)" },
        skip: { type: "array", items: { type: "string" }, description: "건너뛸 승인번호" },
        confirm: CONFIRM_PROP,
      },
      required: ["file"],
    },
  },
] as const

export const CRM_MORE_READ_NAMES = ["list_stock_moves", "list_payments", "list_inquiries"] as const
export type CrmMoreReadName = (typeof CRM_MORE_READ_NAMES)[number]
export type CrmMoreWriteName = Exclude<(typeof CRM_MORE_TOOLS)[number]["name"], CrmMoreReadName>
