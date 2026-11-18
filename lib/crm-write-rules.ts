// CRM 고치기 도구 — 정의 · 입력 읽기 · 「무엇이 어떻게 바뀌나」 계획. DB 를 직접 읽지 않는다(CrmPort 로 받는다) — 시험이 스텁을 넣는다.
// 쓰기는 lib/crm-write-tools.ts 가 화면 API 와 같은 서버 함수(lib/crm-ops.ts)로 한다.
//
// 모든 쓰기는 record_sample 과 같은 방식이다:
//   MCP      — confirm=true 일 때만 쓴다. 없으면 이 계획을 미리보기로 돌려준다
//   앱 AI    — 이 계획이 확인 카드(바뀌기 전 → 뒤, 재고 변화, 0 이하 경고)가 되고, 확인하면 confirm=true 로 실행한다
//   질문 경로 — 미리보기만(confirm 칸이 없다)
// 대상은 ID(또는 코드)로 고른다 — list_samples · find_org · list_products 로 찾는다. 이름이 여럿 걸리면 후보를 돌려주고 묻게 한다.
import { gramsForQuantity, ORG_TYPE_LABEL, QUOTE_STATUS_LABEL, quoteTotals, SHIPMENT_KIND_LABEL, SHIPMENT_STATUS_LABEL } from "@/lib/crm"
import {
  kstToday, normalizeOrgName, pickOrg, productLabel, rankOrgs, resolveProduct, stockText, stockWarning,
  type ProductRow,
} from "@/lib/crm-sample-rules"

// ─── 도구 정의(MCP inputSchema) ─────────────────────────────────────

const CONFIRM = { type: "boolean", description: "사용자가 바뀔 내용에 동의했으면 true. 없으면 쓰지 않고 미리보기만 돌려준다" } as const
const DATE = { type: "string", description: "날짜 YYYY-MM-DD(서울). 비우면 오늘. 앞날은 안 된다" } as const
const ORG_TYPE = { type: "string", enum: ["UNIVERSITY", "RESEARCH", "COMPANY", "HOSPITAL", "OTHER"], description: "기관 종류 — 대학 · 연구원 · 기업 · 병원 · 기타" } as const
const PREVIEW_RULE = "confirm 없이 부르면 쓰지 않고 바뀔 내용(전 → 뒤 · 재고 변화)만 돌려준다 — 사용자에게 보여 주고 동의를 받은 뒤 confirm=true 로 다시 부른다."

export const CRM_WRITE_TOOLS = [
  {
    name: "list_samples",
    description:
      "CRM 샘플요청 목록 — sample_id · 코드 · 날짜 · 기관 · 제품 · 딸린 샘플 출고(수량) · 발송 상태. 최근 것부터. " +
      "샘플 기록을 고치거나 지우려면 먼저 이것으로 sample_id 를 찾는다(update_sample · delete_sample).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "기관 이름 · 기관 코드 · 제품 이름 · 샘플 코드 일부. 비우면 최근 것" },
        limit: { type: "integer", description: "기본 20, 최대 50" },
      },
    },
  },
  {
    name: "update_sample",
    description:
      "CRM 샘플요청 한 건을 고친다 — 날짜 · 기관 · 제품 · 수량 · 요청사항 · 소개경로 · 비고 · 발송 여부. 준 칸만 바뀐다. " +
      "딸린 샘플 출고가 따라간다: 수량을 바꾸면 출고 수량과 재고가, 제품을 바꾸면 출고 · 재고의 제품이 바뀐다. quantity=0 이면 샘플 출고를 지워 재고를 되돌린다. " +
      "sample_id 는 list_samples 로 찾는다. 제품은 list_products 의 product_id. " + PREVIEW_RULE,
    inputSchema: {
      type: "object",
      properties: {
        sample_id: { type: "string", description: "list_samples 의 sample_id(또는 샘플 코드)" },
        date: { type: "string", description: "전달한 날 YYYY-MM-DD. 출고 날짜도 함께 바뀐다" },
        org: { type: "string", description: "기관을 바꿀 때 — find_org 의 기관 코드(ORG001) · 이름" },
        product_id: { type: "string", description: "제품을 바꿀 때 — list_products 의 product_id(또는 코드). 'none' 이면 제품을 비우고 샘플 출고를 지운다" },
        quantity: { type: "integer", description: "샘플 출고 수량(개). 0 이면 출고를 지워 재고를 되돌린다" },
        content: { type: "string", description: "요청사항" },
        referral: { type: "string", description: "소개경로" },
        note: { type: "string", description: "비고" },
        sent: { type: "boolean", description: "발송완료(true) · 미발송(false)" },
        confirm: CONFIRM,
      },
      required: ["sample_id"],
    },
  },
  {
    name: "delete_sample",
    description:
      "CRM 샘플요청 한 건을 지운다. 기본으로 딸린 샘플 출고도 함께 지워 그만큼 재고가 돌아온다(잘못 적은 기록을 거둘 때). " +
      "물건은 실제로 나갔고 요청 기록만 지우려면 keep_shipments=true — 화면에서 지울 때처럼 출고는 남는다. " +
      "sample_id 는 list_samples 로 찾는다. " + PREVIEW_RULE,
    inputSchema: {
      type: "object",
      properties: {
        sample_id: { type: "string", description: "list_samples 의 sample_id(또는 샘플 코드)" },
        keep_shipments: { type: "boolean", description: "true 면 출고 · 재고는 그대로 두고 요청 기록만 지운다" },
        confirm: CONFIRM,
      },
      required: ["sample_id"],
    },
  },
  {
    name: "create_org",
    description:
      "CRM 기관을 새로 만든다. 같은 이름이 있으면 거절하고, 비슷한 이름이 있으면 경고한다 — 먼저 find_org 로 찾아본다. " + PREVIEW_RULE,
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "기관 이름(정식 이름)" },
        org_type: ORG_TYPE,
        address: { type: "string", description: "주소" },
        note: { type: "string", description: "비고" },
        confirm: CONFIRM,
      },
      required: ["name"],
    },
  },
  {
    name: "update_org",
    description:
      "CRM 기관 정보를 고친다 — 이름 · 종류 · 주소 · 비고 · 청구처. 준 칸만 바뀐다. 기관은 find_org 의 코드(ORG001)로 고른다. " + PREVIEW_RULE,
    inputSchema: {
      type: "object",
      properties: {
        org: { type: "string", description: "고칠 기관 — 기관 코드(ORG001) · id · 이름" },
        name: { type: "string", description: "새 이름" },
        org_type: ORG_TYPE,
        address: { type: "string", description: "주소" },
        note: { type: "string", description: "비고" },
        billing_org: { type: "string", description: "청구처(세금계산서를 받는 기관) — 기관 코드 · 이름. 'none' 이면 비운다(자기 자신)" },
        confirm: CONFIRM,
      },
      required: ["org"],
    },
  },
  {
    name: "record_stock",
    description:
      "CRM 재고 장부에 한 줄 적는다 — 입고(in) · 출고/폐기(out) · 실사 보정(count: 세어 본 실제 수량을 주면 차이만큼 맞춘다). " +
      "판매 · 샘플 출고는 여기 말고 record_sample 등 출고 기록으로. 생산은 record_production. 제품은 list_products 의 product_id. " + PREVIEW_RULE,
    inputSchema: {
      type: "object",
      properties: {
        product_id: { type: "string", description: "list_products 의 product_id(또는 코드)" },
        mode: { type: "string", enum: ["in", "out", "count"], description: "in 입고 · out 출고(폐기 등) · count 실사 보정" },
        quantity: { type: "number", description: "in · out 은 움직인 양, count 는 세어 본 실제 재고. 단위는 제품 단위(개 · g)" },
        date: DATE,
        note: { type: "string", description: "사유 — 원료 입고 · 폐기 · 실사 등" },
        confirm: CONFIRM,
      },
      required: ["product_id", "mode", "quantity"],
    },
  },
  {
    name: "record_production",
    description:
      "CRM 생산 한 건 — 완제품이 늘고 원료가 준다(한 번에). 원료 그램을 비우면 제품 용량 · 농도로 계산한다. " +
      "제품 · 원료는 list_products 의 product_id(원료는 단위가 g 인 줄). " + PREVIEW_RULE,
    inputSchema: {
      type: "object",
      properties: {
        product_id: { type: "string", description: "만든 완제품 — list_products 의 product_id(또는 코드)" },
        material_id: { type: "string", description: "쓴 원료 — list_products 의 product_id(또는 코드)" },
        quantity: { type: "integer", description: "만든 수량(개)" },
        material_grams: { type: "number", description: "실제로 쓴 원료 그램. 비우면 계산한다" },
        date: DATE,
        note: { type: "string", description: "비고 — 로트 등" },
        confirm: CONFIRM,
      },
      required: ["product_id", "material_id", "quantity"],
    },
  },
  // ─── 견적 · 출하 · 입금 ───
  {
    name: "list_quotes",
    description:
      "CRM 견적 목록 — quote_id · 코드 · 날짜 · 기관 · 품목 · 합계 · 상태 · 세금계산서 수. 최근 것부터. 견적을 고치거나 지우려면 먼저 이것으로 quote_id 를 찾는다.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "기관 이름 · 기관 코드 · 견적 코드 · 제품 이름 일부. 비우면 최근 것" },
        limit: { type: "integer", description: "기본 20, 최대 50" },
      },
    },
  },
  {
    name: "create_quote",
    description:
      "CRM 견적을 새로 만든다 — 기관 · 품목(제품 · 수량 · 단가) · 할인 · 상태. 단가를 비우면 제품 기본 단가. 합계(공급가 · 부가세 10%)가 미리보기에 보인다. " +
      "기관은 find_org 의 코드, 제품은 list_products 의 product_id. " + PREVIEW_RULE,
    inputSchema: {
      type: "object",
      properties: {
        org: { type: "string", description: "기관 코드(ORG001) · 이름" },
        items: {
          type: "array",
          description: "품목들",
          items: {
            type: "object",
            properties: {
              product_id: { type: "string", description: "list_products 의 product_id(또는 코드)" },
              quantity: { type: "integer", description: "수량" },
              unit_price: { type: "integer", description: "단가(원, 부가세 별도). 비우면 제품 기본 단가" },
            },
            required: ["product_id", "quantity"],
          },
        },
        date: DATE,
        discount: { type: "integer", description: "할인 금액(원). 비우면 0" },
        status: { type: "string", enum: ["DRAFT", "SENT"], description: "작성중(DRAFT, 기본) · 발송(SENT)" },
        note: { type: "string", description: "비고" },
        confirm: CONFIRM,
      },
      required: ["org", "items"],
    },
  },
  {
    name: "update_quote",
    description:
      "CRM 견적의 상태 · 비고를 고친다(화면과 같다 — 품목을 바꾸려면 지우고 새로 만든다). 완료(DONE)로 바꾸고 세금계산서가 없으면 재무 담당에게 발행 요청 알림이 간다. " +
      "quote_id 는 list_quotes 로 찾는다. " + PREVIEW_RULE,
    inputSchema: {
      type: "object",
      properties: {
        quote_id: { type: "string", description: "list_quotes 의 quote_id(또는 견적 코드)" },
        status: { type: "string", enum: ["DRAFT", "SENT", "DONE", "CANCELLED"], description: "작성중 · 발송 · 완료 · 취소" },
        note: { type: "string", description: "비고" },
        confirm: CONFIRM,
      },
      required: ["quote_id"],
    },
  },
  {
    name: "delete_quote",
    description:
      "CRM 견적을 지운다. 품목은 함께 지워지고, 이 견적에서 나간 출고 · 세금계산서는 남고 연결만 끊긴다. quote_id 는 list_quotes 로 찾는다. " + PREVIEW_RULE,
    inputSchema: {
      type: "object",
      properties: {
        quote_id: { type: "string", description: "list_quotes 의 quote_id(또는 견적 코드)" },
        confirm: CONFIRM,
      },
      required: ["quote_id"],
    },
  },
  {
    name: "record_shipment",
    description:
      "CRM 출하(출고) 한 건 — 판매 · 샘플 · 증정으로 제품이 나간 것. 그만큼 재고가 빠진다(재고가 모자라도 적되 경고한다). " +
      "샘플 전달은 record_sample 이 요청 기록까지 함께 남긴다. 기관은 find_org 의 코드, 제품은 list_products 의 product_id, 견적은 list_quotes 의 quote_id. " + PREVIEW_RULE,
    inputSchema: {
      type: "object",
      properties: {
        org: { type: "string", description: "받는 기관 코드(ORG001) · 이름" },
        product_id: { type: "string", description: "list_products 의 product_id(또는 코드)" },
        quantity: { type: "integer", description: "수량(개)" },
        kind: { type: "string", enum: ["SALE", "SAMPLE", "GIFT"], description: "판매(기본) · 샘플 · 증정" },
        status: { type: "string", enum: ["PREPARING", "SHIPPING", "DELIVERED"], description: "준비중 · 배송중 · 배송완료(기본)" },
        quote_id: { type: "string", description: "이어지는 견적(있으면)" },
        date: DATE,
        note: { type: "string", description: "비고 — 송장번호 등" },
        confirm: CONFIRM,
      },
      required: ["org", "product_id", "quantity"],
    },
  },
  {
    name: "list_receivables",
    description:
      "세금계산서별 받을 돈 · 줄 돈 — invoice_id · 거래처 · 발행일 · 합계 · 받은(준) 금액 · 남은 금액. 입금을 적으려면 먼저 이것으로 invoice_id 를 찾는다(record_payment).",
    inputSchema: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["SALE", "PURCHASE"], description: "매출(받을 돈, 기본) · 매입(줄 돈)" },
        query: { type: "string", description: "거래처 이름 · 견적 코드 · 승인번호 일부" },
        include_paid: { type: "boolean", description: "다 받은 것도 보기" },
      },
    },
  },
  {
    name: "record_payment",
    description:
      "세금계산서에 들어온 돈(매출) · 나간 돈(매입) 한 줄을 적는다. 나눠 들어오면 여러 번. 남은 금액보다 많으면 거절된다. " +
      "invoice_id 는 list_receivables 로 찾는다. " + PREVIEW_RULE,
    inputSchema: {
      type: "object",
      properties: {
        invoice_id: { type: "string", description: "list_receivables 의 invoice_id(또는 승인번호)" },
        amount: { type: "integer", description: "금액(원, 부가세 포함 실제 들어온 돈)" },
        date: { type: "string", description: "들어온 날 YYYY-MM-DD. 비우면 오늘" },
        note: { type: "string", description: "비고 — 입금자명 등" },
        confirm: CONFIRM,
      },
      required: ["invoice_id", "amount"],
    },
  },
] as const

/** CRM 도구 중 읽기 — 고칠 대상의 ID 를 찾는다 */
export const CRM_READ_NAMES = ["list_samples", "list_quotes", "list_receivables"] as const
export type CrmWriteToolName = Exclude<(typeof CRM_WRITE_TOOLS)[number]["name"], (typeof CRM_READ_NAMES)[number]>
export const CRM_WRITE_NAMES = CRM_WRITE_TOOLS.map((t) => t.name).filter((n) => !(CRM_READ_NAMES as readonly string[]).includes(n)) as CrmWriteToolName[]
export const isCrmWriteTool = (n: string): n is CrmWriteToolName => (CRM_WRITE_NAMES as string[]).includes(n)

// ─── 계획 ───────────────────────────────────────────────────────────

export interface CrmProductRow extends ProductRow {
  isMaterial?: boolean
  volumeMl?: number | null
  concentrationPct?: number | null
  /** 견적 기본 단가(원) */
  unitPrice?: number | null
}

export interface CrmOrgRow {
  id: string
  code: string
  name: string
  type: keyof typeof ORG_TYPE_LABEL
  address: string | null
  note: string | null
  billingOrgId: string | null
}

export interface CrmSampleView {
  id: string
  code: string
  /** YYYY-MM-DD(서울) */
  date: string
  org: { id: string; name: string }
  productId: string | null
  request: string | null
  referral: string | null
  note: string | null
  sent: boolean
  shipments: { id: string; code: string; quantity: number; productId: string }[]
}

export interface CrmQuoteView {
  id: string
  code: string
  date: string
  org: { id: string; name: string }
  status: keyof typeof QUOTE_STATUS_LABEL
  note: string | null
  discount: number
  vatRate: number
  items: { productId: string; label: string; quantity: number; unitPrice: number }[]
  shipments: number
  taxInvoices: number
}

export interface CrmReceivableView {
  invoiceId: string
  approvalNo: string
  direction: "SALE" | "PURCHASE"
  who: string
  issuedOn: string
  total: number
  paid: number
  remaining: number
}

/** 계획이 읽는 CRM — 서버는 prisma, 시험은 스텁 */
export interface CrmPort {
  products(): Promise<CrmProductRow[]>
  orgs(): Promise<CrmOrgRow[]>
  /** id 또는 코드로 */
  sample(ref: string): Promise<CrmSampleView | null>
  /** id 또는 견적 코드로 */
  quote(ref: string): Promise<CrmQuoteView | null>
  /** 세금계산서 id 또는 승인번호로 — 묶음(수정세금계산서 포함)의 남은 금액 */
  receivable(ref: string): Promise<CrmReceivableView | null>
}

export interface CrmChange {
  label: string
  before: string | null
  after: string
}

/** 계획대로 할 일 — lib/crm-write-tools.ts 가 lib/crm-ops.ts 의 같은 이름 함수로 실행한다 */
export type CrmOp =
  | { kind: "updateSample"; id: string; input: Record<string, unknown> }
  | { kind: "deleteSample"; id: string; withShipments: boolean }
  | { kind: "createOrg"; input: { name: string; type: string; address?: string | null; note?: string | null } }
  | { kind: "updateOrg"; id: string; input: Record<string, unknown> }
  | { kind: "stockMove"; input: { movedAt: string; productId: string; direction: "IN" | "OUT"; quantity: number; note: string | null } }
  | { kind: "production"; input: { producedAt: string; productId: string; materialId: string; quantity: number; materialGrams?: number; note: string | null } }
  | { kind: "createQuote"; input: { quotedAt: string; orgId: string; discountAmount: number; status: "DRAFT" | "SENT"; note: string | null; items: { productId: string; quantity: number; unitPrice: number }[] } }
  | { kind: "updateQuote"; id: string; input: { status?: string; note?: string | null } }
  | { kind: "deleteQuote"; id: string }
  | { kind: "shipment"; input: { shippedAt: string; kind: string; orgId: string; productId: string; quantity: number; status: string; quoteId: string | null; note: string | null } }
  | { kind: "payment"; input: { invoiceId: string; paidOn: string; amountKrw: number; note: string | null } }

export interface CrmPlan {
  title: string
  target: string
  changes: CrmChange[]
  /** 확인하면 무슨 일이 따라오나 */
  risk: string
  /** 재고가 0 이하가 되는 등 — 쓰기는 되지만 눈여겨볼 것 */
  warning?: string | null
  /** 실행해도 실패할 까닭 · 먼저 물을 것 — 있으면 쓰지 않는다 */
  problem?: string
  op?: CrmOp
  /** 활동 기록 · 결과 문장 */
  done?: { entity: string; action: "create" | "update" | "delete"; title: string }
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "")
const has = (args: Record<string, unknown>, k: string) => args[k] !== undefined && args[k] !== null && !(typeof args[k] === "string" && str(args[k]) === "")
const fail = (title: string, target: string, problem: string): CrmPlan => ({ title, target, changes: [], risk: "", problem })
const round3 = (n: number) => Math.round(n * 1000) / 1000
const NONE = /^(none|없음|비움|null)$/i

/** 날짜 — 비우면 오늘. 앞날은 안 된다(일어난 일을 적는다) */
export function parseDate(v: unknown, now = new Date()): { date: string } | { problem: string } {
  const today = kstToday(now)
  const d = str(v) || today
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) return { problem: "date 는 YYYY-MM-DD 입니다." }
  if (d > today) return { problem: `date(${d})가 오늘(${today}) 뒤입니다. 일어난 날을 적으세요.` }
  return { date: d }
}

/** 기관 고르기 — id · 코드가 같으면 그것, 아니면 이름(find_org 와 같은 규칙). 여럿이면 후보를 돌려준다 */
export function resolveOrgRef(ref: string, orgs: CrmOrgRow[]): { org: CrmOrgRow } | { problem: string } {
  const key = ref.trim()
  const exact = orgs.find((o) => o.id === key || o.code.toUpperCase() === key.toUpperCase())
  if (exact) return { org: exact }
  const pick = pickOrg(rankOrgs(key, orgs))
  if (pick.kind === "one") return { org: pick.org }
  if (pick.kind === "many") return { problem: `'${key}' 에 기관이 여럿 걸립니다: ${pick.candidates.map((o) => `${o.name}(${o.code})`).join(" / ")}. 어느 곳인지 사용자에게 묻고 기관 코드로 다시 부르세요.` }
  return { problem: `'${key}' 기관이 CRM 에 없습니다. find_org 로 찾아보세요 — 새로 만들려면 create_org.` }
}

function productRef(ref: string, products: CrmProductRow[]): { product: CrmProductRow } | { problem: string } {
  const r = resolveProduct({ productId: ref, product: null }, products)
  if ("problem" in r) return r
  return r.product ? { product: r.product } : { problem: "제품이 비어 있습니다." }
}

const stockRow = (p: CrmProductRow, before: number, after: number): CrmChange => ({
  label: `재고 · ${productLabel(p)}`, before: stockText(before, p.unit), after: stockText(round3(after), p.unit),
})

/** 바뀌는 재고 줄 · 경고 — delta 는 늘면 +, 줄면 − */
function stockEffect(p: CrmProductRow, delta: number): { row: CrmChange; warning: string | null } {
  const after = round3(p.stock + delta)
  return { row: stockRow(p, p.stock, after), warning: delta < 0 ? stockWarning(p.stock, -delta, p.unit) : null }
}

const joinWarn = (ws: (string | null | undefined)[]) => ws.filter(Boolean).join(" ") || null

// ─── 도구별 계획 ─────────────────────────────────────────────────────

export async function planCrmWrite(name: CrmWriteToolName, args: Record<string, unknown>, port: CrmPort, now = new Date()): Promise<CrmPlan> {
  switch (name) {
    case "update_sample": return planUpdateSample(args, port, now)
    case "delete_sample": return planDeleteSample(args, port)
    case "create_org": return planCreateOrg(args, port)
    case "update_org": return planUpdateOrg(args, port)
    case "record_stock": return planStock(args, port, now)
    case "record_production": return planProduction(args, port, now)
    case "create_quote": return planCreateQuote(args, port, now)
    case "update_quote": return planUpdateQuote(args, port)
    case "delete_quote": return planDeleteQuote(args, port)
    case "record_shipment": return planShipment(args, port, now)
    case "record_payment": return planPayment(args, port, now)
  }
}

async function planUpdateSample(args: Record<string, unknown>, port: CrmPort, now: Date): Promise<CrmPlan> {
  const T = "CRM 샘플 기록 고치기"
  const ref = str(args.sample_id)
  if (!ref) return fail(T, "(샘플 없음)", "sample_id 가 비어 있습니다 — list_samples 로 찾으세요.")
  const s = await port.sample(ref)
  if (!s) return fail(T, ref, `'${ref}' 샘플요청이 없습니다 — list_samples 로 sample_id 를 확인하세요.`)
  const target = `${s.code} · ${s.org.name} · ${s.date}`
  const products = await port.products()
  const changes: CrmChange[] = []
  const input: Record<string, unknown> = {}
  const warnings: (string | null)[] = []

  if (has(args, "date")) {
    const d = parseDate(args.date, now)
    if ("problem" in d) return fail(T, target, d.problem)
    if (d.date !== s.date) { input.requestedAt = d.date; changes.push({ label: "전달일", before: s.date, after: d.date }) }
  }
  if (has(args, "org")) {
    const o = resolveOrgRef(str(args.org), await port.orgs())
    if ("problem" in o) return fail(T, target, o.problem)
    if (o.org.id !== s.org.id) { input.orgId = o.org.id; changes.push({ label: "기관", before: s.org.name, after: o.org.name }) }
  }
  for (const [k, field, label] of [["content", "request", "요청사항"], ["referral", "referral", "소개경로"], ["note", "note", "비고"]] as const) {
    if (!has(args, k)) continue
    const v = str(args[k]).slice(0, k === "referral" ? 200 : 2000)
    if (v !== (s[field] ?? "")) { input[field] = v; changes.push({ label, before: s[field] || "(없음)", after: v }) }
  }
  if (typeof args.sent === "boolean" && args.sent !== s.sent) {
    input.sent = args.sent
    changes.push({ label: "상태", before: s.sent ? "발송완료" : "미발송", after: args.sent ? "발송완료" : "미발송" })
  }

  // 제품 · 수량 — 딸린 샘플 출고와 재고가 따라간다
  const byId = new Map(products.map((p) => [p.id, p]))
  const ship = s.shipments[0] ?? null
  const oldProduct = s.productId ? byId.get(s.productId) ?? null : null
  let newProduct = oldProduct
  if (has(args, "product_id")) {
    if (NONE.test(str(args.product_id))) newProduct = null
    else {
      const r = productRef(str(args.product_id), products)
      if ("problem" in r) return fail(T, target, r.problem)
      newProduct = r.product
    }
  }
  let qty: number | null = ship ? ship.quantity : null
  if (has(args, "quantity")) {
    const n = Number(args.quantity)
    if (!Number.isInteger(n) || n < 0 || n > 10000) return fail(T, target, "quantity 는 0~10000 의 정수입니다(0 이면 샘플 출고를 지웁니다).")
    qty = n
  }
  const productChanged = (newProduct?.id ?? null) !== (s.productId ?? null)
  const qtyChanged = qty !== (ship ? ship.quantity : null)
  if ((productChanged || qtyChanged) && s.shipments.length > 1) {
    return fail(T, target, `이 샘플요청에 출고가 ${s.shipments.length}건(${s.shipments.map((x) => x.code).join(", ")}) 있습니다 — 수량 · 제품은 CRM › 출고에서 출고마다 고쳐 주세요.`)
  }
  if (productChanged) {
    input.productId = newProduct ? newProduct.id : null
    changes.push({ label: "제품", before: oldProduct ? productLabel(oldProduct) : "(없음)", after: newProduct ? productLabel(newProduct) : "(없음 — 샘플 출고를 지웁니다)" })
  }
  if (qtyChanged && qty !== null) input.quantity = qty
  // 재고 계산 — 원래 출고분을 되돌리고 새 출고분을 뺀다
  const shipProduct = ship ? byId.get(ship.productId) ?? null : null
  const removeShip = ship && (qty === 0 || newProduct === null)
  if (ship && shipProduct && (productChanged || qtyChanged)) {
    if (removeShip) {
      changes.push({ label: "샘플 출고", before: `${ship.code} · ${ship.quantity}개`, after: "지웁니다 — 재고가 돌아옵니다" })
      changes.push(stockEffect(shipProduct, ship.quantity).row)
    } else if (newProduct && newProduct.id !== shipProduct.id) {
      changes.push({ label: "샘플 출고", before: `${ship.code} · ${productLabel(shipProduct)} ${ship.quantity}개`, after: `${productLabel(newProduct)} ${qty}개` })
      changes.push(stockEffect(shipProduct, ship.quantity).row)
      const e = stockEffect(newProduct, -(qty ?? 0))
      changes.push(e.row); warnings.push(e.warning)
    } else if (qtyChanged && qty !== null) {
      changes.push({ label: "샘플 출고", before: `${ship.code} · ${ship.quantity}개`, after: `${qty}개` })
      const e = stockEffect(shipProduct, ship.quantity - qty)
      changes.push(e.row); warnings.push(e.warning)
    }
  } else if (!ship && qty && qty > 0) {
    if (!newProduct) return fail(T, target, "이 샘플요청에는 제품이 없어 샘플 출고를 만들 수 없습니다 — product_id 를 함께 주세요(list_products).")
    changes.push({ label: "샘플 출고", before: null, after: `${productLabel(newProduct)} ${qty}개 — 새로 남깁니다` })
    const e = stockEffect(newProduct, -qty)
    changes.push(e.row); warnings.push(e.warning)
  }
  if (changes.length === 0) return fail(T, target, "바뀌는 것이 없습니다 — 고칠 칸(date · org · product_id · quantity · content · referral · note · sent)을 주세요.")
  return {
    title: T, target, changes,
    warning: joinWarn(warnings),
    risk: [
      "CRM 샘플요청이 바뀌고 활동 기록에 내 이름으로 남습니다.",
      changes.some((c) => c.label.startsWith("재고")) ? "딸린 샘플 출고와 재고 장부가 함께 바뀝니다." : null,
    ].filter(Boolean).join(" "),
    op: { kind: "updateSample", id: s.id, input },
    done: { entity: "crm.sample", action: "update", title: `샘플요청 고침 ${s.code} · ${s.org.name}` },
  }
}

async function planDeleteSample(args: Record<string, unknown>, port: CrmPort): Promise<CrmPlan> {
  const T = "CRM 샘플 기록 지우기"
  const ref = str(args.sample_id)
  if (!ref) return fail(T, "(샘플 없음)", "sample_id 가 비어 있습니다 — list_samples 로 찾으세요.")
  const s = await port.sample(ref)
  if (!s) return fail(T, ref, `'${ref}' 샘플요청이 없습니다 — list_samples 로 sample_id 를 확인하세요.`)
  const keep = args.keep_shipments === true
  const products = new Map((await port.products()).map((p) => [p.id, p]))
  const sp = s.productId ? products.get(s.productId) : null
  const changes: CrmChange[] = [
    { label: "지울 샘플요청", before: [s.code, s.date, s.org.name, sp ? productLabel(sp) : null, s.request, s.sent ? "발송완료" : "미발송"].filter(Boolean).join(" · "), after: "지움" },
  ]
  if (s.shipments.length) {
    for (const sh of s.shipments) {
      const p = products.get(sh.productId)
      changes.push({ label: "샘플 출고", before: `${sh.code} · ${p ? productLabel(p) : "제품"} ${sh.quantity}개`, after: keep ? "남깁니다(연결만 끊김)" : "지웁니다" })
    }
    if (!keep) {
      // 같은 제품 출고가 여럿이면 합쳐서 한 줄
      const back = new Map<string, number>()
      for (const sh of s.shipments) back.set(sh.productId, (back.get(sh.productId) ?? 0) + sh.quantity)
      for (const [pid, q] of back) {
        const p = products.get(pid)
        if (p) changes.push(stockEffect(p, q).row)
      }
    }
  }
  return {
    title: T, target: `${s.code} · ${s.org.name} · ${s.date}`, changes,
    risk: [
      "샘플요청 한 줄을 지웁니다. 되돌릴 수 없습니다 — 다시 넣으려면 record_sample 로 새로 적어야 합니다.",
      s.shipments.length && !keep ? "딸린 샘플 출고와 그 재고 줄도 지워져 재고가 돌아옵니다." : null,
      s.shipments.length && keep ? "출고 · 재고는 그대로 남습니다." : null,
    ].filter(Boolean).join(" "),
    op: { kind: "deleteSample", id: s.id, withShipments: !keep },
    done: { entity: "crm.sample", action: "delete", title: `샘플요청 지움 ${s.code} · ${s.org.name}` },
  }
}

const ORG_TYPES = Object.keys(ORG_TYPE_LABEL)
function orgType(v: unknown): { type: string | null } | { problem: string } {
  const t = str(v).toUpperCase()
  if (!t) return { type: null }
  return ORG_TYPES.includes(t) ? { type: t } : { problem: `org_type 은 ${ORG_TYPES.join(" · ")} 중 하나입니다.` }
}

async function planCreateOrg(args: Record<string, unknown>, port: CrmPort): Promise<CrmPlan> {
  const T = "CRM 기관 만들기"
  const name = str(args.name).slice(0, 200)
  if (!name) return fail(T, "(이름 없음)", "name(기관 이름)이 비어 있습니다.")
  const t = orgType(args.org_type)
  if ("problem" in t) return fail(T, name, t.problem)
  const orgs = await port.orgs()
  const same = orgs.find((o) => o.name === name)
  if (same) return fail(T, name, `같은 이름의 기관이 이미 있습니다: ${same.name}(${same.code}). 고치려면 update_org.`)
  const similar = rankOrgs(name, orgs).filter((r) => r.score >= 2 || normalizeOrgName(r.org.name) === normalizeOrgName(name)).slice(0, 3)
  const type = t.type ?? "OTHER"
  const address = str(args.address).slice(0, 500) || null
  const note = str(args.note).slice(0, 2000) || null
  const changes: CrmChange[] = [
    { label: "기관", before: null, after: name },
    { label: "종류", before: null, after: ORG_TYPE_LABEL[type as keyof typeof ORG_TYPE_LABEL] },
  ]
  if (address) changes.push({ label: "주소", before: null, after: address })
  if (note) changes.push({ label: "비고", before: null, after: note })
  return {
    title: T, target: name, changes,
    warning: similar.length ? `비슷한 이름의 기관이 있습니다: ${similar.map((r) => `${r.org.name}(${r.org.code})`).join(" / ")} — 같은 곳이면 만들지 말고 그 기관을 쓰세요. 이름이 둘로 갈리면 견적 · 계산서가 나뉩니다.` : null,
    risk: "CRM 기관 목록에 새 기관이 생기고 기관 코드(ORG…)가 붙습니다. 활동 기록에 내 이름으로 남습니다.",
    op: { kind: "createOrg", input: { name, type, address, note } },
    done: { entity: "crm.org", action: "create", title: `기관 추가 ${name}` },
  }
}

async function planUpdateOrg(args: Record<string, unknown>, port: CrmPort): Promise<CrmPlan> {
  const T = "CRM 기관 고치기"
  const ref = str(args.org)
  if (!ref) return fail(T, "(기관 없음)", "org(고칠 기관)가 비어 있습니다 — find_org 로 찾으세요.")
  const orgs = await port.orgs()
  const r = resolveOrgRef(ref, orgs)
  if ("problem" in r) return fail(T, ref, r.problem)
  const o = r.org
  const target = `${o.name} (${o.code})`
  const changes: CrmChange[] = []
  const input: Record<string, unknown> = {}
  if (has(args, "name")) {
    const name = str(args.name).slice(0, 200)
    if (name !== o.name) {
      const dup = orgs.find((x) => x.name === name && x.id !== o.id)
      if (dup) return fail(T, target, `같은 이름의 기관이 이미 있습니다: ${dup.name}(${dup.code}).`)
      input.name = name; changes.push({ label: "이름", before: o.name, after: name })
    }
  }
  if (has(args, "org_type")) {
    const t = orgType(args.org_type)
    if ("problem" in t) return fail(T, target, t.problem)
    if (t.type && t.type !== o.type) { input.type = t.type; changes.push({ label: "종류", before: ORG_TYPE_LABEL[o.type], after: ORG_TYPE_LABEL[t.type as keyof typeof ORG_TYPE_LABEL] }) }
  }
  for (const [k, label, max] of [["address", "주소", 500], ["note", "비고", 2000]] as const) {
    if (!has(args, k)) continue
    const v = str(args[k]).slice(0, max)
    if (v !== (o[k] ?? "")) { input[k] = v || null; changes.push({ label, before: o[k] || "(없음)", after: v || "(비움)" }) }
  }
  if (has(args, "billing_org")) {
    const cur = o.billingOrgId ? orgs.find((x) => x.id === o.billingOrgId) : null
    if (NONE.test(str(args.billing_org))) {
      if (cur) { input.billingOrgId = null; changes.push({ label: "청구처", before: `${cur.name}(${cur.code})`, after: "(자기 자신)" }) }
    } else {
      const b = resolveOrgRef(str(args.billing_org), orgs)
      if ("problem" in b) return fail(T, target, b.problem)
      if (b.org.id !== o.billingOrgId) {
        // 화면과 같은 규칙(lib/crm billingOrgProblem)은 실행할 때 lib/crm-ops updateOrg 가 다시 본다 — 여기서는 미리 알려 준다
        if (b.org.id === o.id) return fail(T, target, "자기 자신을 청구처로 둘 수 없습니다 — 비우려면 billing_org='none'.")
        if (b.org.billingOrgId) return fail(T, target, `${b.org.name} 에도 청구처가 따로 있습니다 — 최종 청구처를 골라 주세요.`)
        if (orgs.some((x) => x.billingOrgId === o.id)) return fail(T, target, "이 기관은 다른 기관의 청구처입니다 — 청구처에는 청구처를 둘 수 없습니다.")
        input.billingOrgId = b.org.id
        changes.push({ label: "청구처", before: cur ? `${cur.name}(${cur.code})` : "(자기 자신)", after: `${b.org.name}(${b.org.code})` })
      }
    }
  }
  if (changes.length === 0) return fail(T, target, "바뀌는 것이 없습니다 — 고칠 칸(name · org_type · address · note · billing_org)을 주세요.")
  return {
    title: T, target, changes,
    risk: "CRM 기관 정보가 바뀌고 활동 기록에 내 이름으로 남습니다. 이 기관의 견적 · 샘플 · 계산서 화면에 새 값이 보입니다.",
    op: { kind: "updateOrg", id: o.id, input },
    done: { entity: "crm.org", action: "update", title: `기관 고침 ${o.code} ${input.name ?? o.name}` },
  }
}

async function planStock(args: Record<string, unknown>, port: CrmPort, now: Date): Promise<CrmPlan> {
  const mode = str(args.mode).toLowerCase()
  const T = mode === "count" ? "CRM 재고 실사 보정" : mode === "out" ? "CRM 재고 출고(폐기 등)" : "CRM 재고 입고"
  if (!["in", "out", "count"].includes(mode)) return fail(T, "(제품)", "mode 는 in · out · count 중 하나입니다.")
  const pr = productRef(str(args.product_id), await port.products())
  if ("problem" in pr) return fail(T, str(args.product_id) || "(제품 없음)", pr.problem)
  const p = pr.product
  const target = `${productLabel(p)} (${p.code})`
  const n = Number(args.quantity)
  if (!Number.isFinite(n) || n < 0 || (mode !== "count" && n === 0)) return fail(T, target, mode === "count" ? "quantity(세어 본 재고)는 0 이상입니다." : "quantity 는 0보다 커야 합니다.")
  if (p.unit === "PIECE" && !Number.isInteger(n)) return fail(T, target, "이 제품은 개 단위라 quantity 는 정수입니다.")
  const d = parseDate(args.date, now)
  if ("problem" in d) return fail(T, target, d.problem)
  let direction: "IN" | "OUT" = mode === "out" ? "OUT" : "IN"
  let qty = round3(n)
  if (mode === "count") {
    const diff = round3(n - p.stock)
    if (diff === 0) return fail(T, target, `장부 재고가 이미 ${stockText(p.stock, p.unit)}입니다 — 맞출 것이 없습니다.`)
    direction = diff > 0 ? "IN" : "OUT"
    qty = Math.abs(diff)
  }
  const note = str(args.note).slice(0, 500) || (mode === "count" ? `실사 보정(세어 본 재고 ${stockText(n, p.unit)})` : null)
  const e = stockEffect(p, direction === "IN" ? qty : -qty)
  return {
    title: T, target,
    changes: [
      { label: "장부 한 줄", before: null, after: `${d.date} · ${direction === "IN" ? "입고" : "출고"} ${stockText(qty, p.unit)}${note ? ` · ${note}` : ""}` },
      e.row,
    ],
    warning: mode === "count" ? null : e.warning,
    risk: "CRM 재고 장부에 한 줄이 생겨 이 제품 재고가 바뀝니다. 활동 기록에 내 이름으로 남습니다. 잘못 적었으면 CRM › 재고에서 그 줄을 지웁니다.",
    op: { kind: "stockMove", input: { movedAt: d.date, productId: p.id, direction, quantity: qty, note } },
    done: { entity: "crm.stock", action: "create", title: `재고 ${direction === "IN" ? "입고" : "출고"} ${productLabel(p)} ${stockText(qty, p.unit)}` },
  }
}

async function planProduction(args: Record<string, unknown>, port: CrmPort, now: Date): Promise<CrmPlan> {
  const T = "CRM 생산 기록"
  const products = await port.products()
  const pr = productRef(str(args.product_id), products)
  if ("problem" in pr) return fail(T, str(args.product_id) || "(제품 없음)", pr.problem)
  const p = pr.product
  const target = `${productLabel(p)} (${p.code})`
  const mr = productRef(str(args.material_id), products)
  if ("problem" in mr) return fail(T, target, mr.problem.replace("제품", "원료"))
  const m = mr.product
  if (!m.isMaterial) return fail(T, target, `${productLabel(m)} 은 원료가 아닙니다 — list_products 에서 원료(g 단위) 줄의 product_id 를 고르세요.`)
  const q = Number(args.quantity)
  if (!Number.isInteger(q) || q < 1) return fail(T, target, "quantity(생산 수량)는 1 이상의 정수입니다.")
  const d = parseDate(args.date, now)
  if ("problem" in d) return fail(T, target, d.problem)
  let grams: number | null = null
  if (has(args, "material_grams")) {
    const g = Number(args.material_grams)
    if (!Number.isFinite(g) || g <= 0) return fail(T, target, "material_grams 는 0보다 커야 합니다.")
    grams = g
  } else grams = gramsForQuantity(q, p.volumeMl ?? null, p.concentrationPct ?? null)
  if (grams == null) return fail(T, target, `${p.name} 은 용량(ml) 또는 농도(wt%)가 비어 있어 소요량을 계산할 수 없습니다. 쓴 그램을 material_grams 로 주세요.`)
  grams = round3(grams)
  const note = str(args.note).slice(0, 2000) || null
  const made = stockEffect(p, q)
  const used = stockEffect(m, -grams)
  return {
    title: T, target,
    changes: [
      { label: "생산", before: null, after: `${d.date} · ${productLabel(p)} ${q}개${note ? ` · ${note}` : ""}` },
      { label: "원료 사용", before: null, after: `${productLabel(m)} ${stockText(grams, m.unit)}${has(args, "material_grams") ? "" : " (용량 · 농도로 계산)"}` },
      made.row,
      used.row,
    ],
    warning: used.warning,
    risk: "CRM 생산 기록 한 건이 생기고 완제품 재고는 늘고 원료 재고는 줍니다(한 번에). 활동 기록에 내 이름으로 남습니다. 잘못 적었으면 CRM › 재고 화면에서 고칩니다.",
    op: { kind: "production", input: { producedAt: d.date, productId: p.id, materialId: m.id, quantity: q, materialGrams: grams, note } },
    done: { entity: "crm.production", action: "create", title: `생산 ${productLabel(p)} ${q}개` },
  }
}

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`
const totalsRows = (t: ReturnType<typeof quoteTotals>): CrmChange[] => [
  { label: "공급가", before: null, after: won(t.supply) },
  ...(t.discount ? [{ label: "할인", before: null, after: won(t.discount) }] : []),
  { label: "부가세", before: null, after: won(t.vat) },
  { label: "합계", before: null, after: won(t.total) },
]

async function planCreateQuote(args: Record<string, unknown>, port: CrmPort, now: Date): Promise<CrmPlan> {
  const T = "CRM 견적 만들기"
  const o = resolveOrgRef(str(args.org), await port.orgs())
  if (!str(args.org)) return fail(T, "(기관 없음)", "org(기관)가 비어 있습니다 — find_org 로 찾으세요.")
  if ("problem" in o) return fail(T, str(args.org), o.problem)
  const target = `${o.org.name} (${o.org.code})`
  const raw = Array.isArray(args.items) ? args.items : []
  if (raw.length === 0) return fail(T, target, "items(품목)가 비어 있습니다 — [{product_id, quantity, unit_price}].")
  if (raw.length > 30) return fail(T, target, "품목이 너무 많습니다(30 초과).")
  const products = await port.products()
  const items: { product: CrmProductRow; quantity: number; unitPrice: number }[] = []
  for (const [i, it] of raw.entries()) {
    const r = (it ?? {}) as Record<string, unknown>
    const pr = productRef(str(r.product_id), products)
    if ("problem" in pr) return fail(T, target, `${i + 1}번째 품목: ${pr.problem}`)
    const q = Number(r.quantity)
    if (!Number.isInteger(q) || q < 1) return fail(T, target, `${i + 1}번째 품목: quantity 는 1 이상의 정수입니다.`)
    const price = has(r, "unit_price") ? Number(r.unit_price) : pr.product.unitPrice ?? null
    if (price === null) return fail(T, target, `${i + 1}번째 품목(${productLabel(pr.product)})에 기본 단가가 없습니다 — unit_price 를 주세요.`)
    if (!Number.isInteger(price) || price < 0) return fail(T, target, `${i + 1}번째 품목: unit_price 는 0 이상의 정수(원)입니다.`)
    items.push({ product: pr.product, quantity: q, unitPrice: price })
  }
  const d = parseDate(args.date, now)
  if ("problem" in d) return fail(T, target, d.problem)
  const discount = has(args, "discount") ? Number(args.discount) : 0
  if (!Number.isInteger(discount) || discount < 0) return fail(T, target, "discount 는 0 이상의 정수(원)입니다.")
  const status = str(args.status).toUpperCase() || "DRAFT"
  if (status !== "DRAFT" && status !== "SENT") return fail(T, target, "새 견적의 status 는 DRAFT(작성중) · SENT(발송) 중 하나입니다.")
  const note = str(args.note).slice(0, 2000) || null
  const t = quoteTotals(items, discount, 10)
  return {
    title: T, target,
    changes: [
      { label: "견적일", before: null, after: d.date },
      ...items.map((it, i) => ({ label: `품목 ${i + 1}`, before: null, after: `${productLabel(it.product)} ${it.quantity}개 × ${won(it.unitPrice)} = ${won(it.quantity * it.unitPrice)}` })),
      ...totalsRows(t),
      { label: "상태", before: null, after: QUOTE_STATUS_LABEL[status as "DRAFT"] },
      ...(note ? [{ label: "비고", before: null, after: note }] : []),
    ],
    warning: discount > t.supply ? `할인(${won(discount)})이 공급가보다 커서 공급가만큼만 깎입니다.` : null,
    risk: "CRM 견적 한 건이 생기고 견적 코드(HADD…)가 붙습니다. 재고는 바뀌지 않습니다(출하를 적을 때 빠집니다). 활동 기록에 내 이름으로 남습니다.",
    op: { kind: "createQuote", input: { quotedAt: d.date, orgId: o.org.id, discountAmount: discount, status, note, items: items.map((it) => ({ productId: it.product.id, quantity: it.quantity, unitPrice: it.unitPrice })) } },
    done: { entity: "crm.quote", action: "create", title: `견적 ${o.org.name} ${won(t.total)}` },
  }
}

const quoteLine = (q: CrmQuoteView) => {
  const t = quoteTotals(q.items, q.discount, q.vatRate)
  return [q.code, q.date, q.org.name, q.items.map((i) => `${i.label} ${i.quantity}개`).join(", "), won(t.total), QUOTE_STATUS_LABEL[q.status]].join(" · ")
}

async function planUpdateQuote(args: Record<string, unknown>, port: CrmPort): Promise<CrmPlan> {
  const T = "CRM 견적 고치기"
  const ref = str(args.quote_id)
  if (!ref) return fail(T, "(견적 없음)", "quote_id 가 비어 있습니다 — list_quotes 로 찾으세요.")
  const q = await port.quote(ref)
  if (!q) return fail(T, ref, `'${ref}' 견적이 없습니다 — list_quotes 로 quote_id 를 확인하세요.`)
  const target = quoteLine(q)
  const changes: CrmChange[] = []
  const input: { status?: string; note?: string | null } = {}
  if (has(args, "status")) {
    const st = str(args.status).toUpperCase()
    if (!(st in QUOTE_STATUS_LABEL)) return fail(T, target, "status 는 DRAFT · SENT · DONE · CANCELLED 중 하나입니다.")
    if (st !== q.status) { input.status = st; changes.push({ label: "상태", before: QUOTE_STATUS_LABEL[q.status], after: QUOTE_STATUS_LABEL[st as "DRAFT"] }) }
  }
  if (has(args, "note")) {
    const v = str(args.note).slice(0, 2000)
    if (v !== (q.note ?? "")) { input.note = v || null; changes.push({ label: "비고", before: q.note || "(없음)", after: v || "(비움)" }) }
  }
  if (changes.length === 0) return fail(T, target, "바뀌는 것이 없습니다 — status · note 를 주세요(품목은 지우고 새로 만듭니다).")
  const invoiceAsk = input.status === "DONE" && q.taxInvoices === 0
  return {
    title: T, target, changes,
    risk: [
      "CRM 견적이 바뀌고 활동 기록에 내 이름으로 남습니다.",
      invoiceAsk ? "완료로 바뀌고 세금계산서가 없어 재무 담당에게 세금계산서 발행 요청 알림이 갑니다." : null,
    ].filter(Boolean).join(" "),
    op: { kind: "updateQuote", id: q.id, input },
    done: { entity: "crm.quote", action: "update", title: `견적 고침 ${q.code} · ${q.org.name}` },
  }
}

async function planDeleteQuote(args: Record<string, unknown>, port: CrmPort): Promise<CrmPlan> {
  const T = "CRM 견적 지우기"
  const ref = str(args.quote_id)
  if (!ref) return fail(T, "(견적 없음)", "quote_id 가 비어 있습니다 — list_quotes 로 찾으세요.")
  const q = await port.quote(ref)
  if (!q) return fail(T, ref, `'${ref}' 견적이 없습니다 — list_quotes 로 quote_id 를 확인하세요.`)
  const t = quoteTotals(q.items, q.discount, q.vatRate)
  return {
    title: T, target: `${q.code} · ${q.org.name}`,
    changes: [
      { label: "지울 견적", before: quoteLine(q), after: "지움" },
      ...q.items.map((it, i) => ({ label: `품목 ${i + 1}`, before: `${it.label} ${it.quantity}개 × ${won(it.unitPrice)}`, after: "함께 지움" })),
      { label: "합계", before: won(t.total), after: "지움" },
    ],
    warning: q.taxInvoices ? `이 견적에 세금계산서 ${q.taxInvoices}장이 이어져 있습니다 — 계산서는 남고 견적과의 연결만 끊깁니다.` : null,
    risk: [
      "견적과 품목을 지웁니다. 되돌릴 수 없습니다 — 다시 넣으려면 새로 만들어야 합니다.",
      q.shipments ? `이 견적에서 나간 출고 ${q.shipments}건은 남고 연결만 끊깁니다(재고는 그대로).` : null,
    ].filter(Boolean).join(" "),
    op: { kind: "deleteQuote", id: q.id },
    done: { entity: "crm.quote", action: "delete", title: `견적 지움 ${q.code} · ${q.org.name}` },
  }
}

async function planShipment(args: Record<string, unknown>, port: CrmPort, now: Date): Promise<CrmPlan> {
  const T = "CRM 출하 기록"
  if (!str(args.org)) return fail(T, "(기관 없음)", "org(받는 기관)가 비어 있습니다 — find_org 로 찾으세요.")
  const o = resolveOrgRef(str(args.org), await port.orgs())
  if ("problem" in o) return fail(T, str(args.org), o.problem)
  const pr = productRef(str(args.product_id), await port.products())
  if ("problem" in pr) return fail(T, o.org.name, pr.problem)
  const p = pr.product
  const target = `${o.org.name} · ${productLabel(p)}`
  const q = Number(args.quantity)
  if (!Number.isInteger(q) || q < 1) return fail(T, target, "quantity 는 1 이상의 정수입니다.")
  const kind = str(args.kind).toUpperCase() || "SALE"
  if (!(kind in SHIPMENT_KIND_LABEL)) return fail(T, target, "kind 는 SALE · SAMPLE · GIFT 중 하나입니다.")
  const status = str(args.status).toUpperCase() || "DELIVERED"
  if (!(status in SHIPMENT_STATUS_LABEL)) return fail(T, target, "status 는 PREPARING · SHIPPING · DELIVERED 중 하나입니다.")
  const d = parseDate(args.date, now)
  if ("problem" in d) return fail(T, target, d.problem)
  let quote: CrmQuoteView | null = null
  if (has(args, "quote_id")) {
    quote = await port.quote(str(args.quote_id))
    if (!quote) return fail(T, target, `'${str(args.quote_id)}' 견적이 없습니다 — list_quotes 로 확인하세요.`)
    if (quote.org.id !== o.org.id) return fail(T, target, `견적 ${quote.code} 는 ${quote.org.name} 의 견적입니다 — 기관이 다릅니다.`)
  }
  const note = str(args.note).slice(0, 2000) || null
  const e = stockEffect(p, -q)
  return {
    title: T, target,
    changes: [
      { label: "출하", before: null, after: `${d.date} · ${o.org.name} · ${productLabel(p)} ${q}개 · ${SHIPMENT_KIND_LABEL[kind as "SALE"]} · ${SHIPMENT_STATUS_LABEL[status as "DELIVERED"]}` },
      ...(quote ? [{ label: "견적", before: null, after: quote.code }] : []),
      ...(note ? [{ label: "비고", before: null, after: note }] : []),
      e.row,
    ],
    warning: e.warning,
    risk: "CRM 출고 한 건과 그만큼 재고 출고가 함께 남습니다(한 번에). 활동 기록에 내 이름으로 남습니다. 잘못 적었으면 CRM › 출고에서 지우면 재고가 돌아옵니다.",
    op: { kind: "shipment", input: { shippedAt: d.date, kind, orgId: o.org.id, productId: p.id, quantity: q, status, quoteId: quote?.id ?? null, note } },
    done: { entity: "crm.shipment", action: "create", title: `출하 ${o.org.name} · ${productLabel(p)} ${q}개` },
  }
}

async function planPayment(args: Record<string, unknown>, port: CrmPort, now: Date): Promise<CrmPlan> {
  const T = "CRM 입금 기록"
  const ref = str(args.invoice_id)
  if (!ref) return fail(T, "(계산서 없음)", "invoice_id 가 비어 있습니다 — list_receivables 로 찾으세요.")
  const r = await port.receivable(ref)
  if (!r) return fail(T, ref, `'${ref}' 세금계산서가 없습니다 — list_receivables 로 invoice_id 를 확인하세요.`)
  const word = r.direction === "SALE" ? "입금" : "지급"
  const target = `${r.who} · ${r.issuedOn} 발행 · 합계 ${won(r.total)}`
  const amount = Number(args.amount)
  if (!Number.isInteger(amount) || amount <= 0) return fail(T, target, "amount 는 0보다 큰 정수(원)입니다.")
  if (amount > r.remaining) return fail(T, target, `남은 금액(${won(r.remaining)})보다 많습니다 — 이미 ${won(r.paid)} 적혀 있습니다. 금액을 확인하세요.`)
  const d = parseDate(args.date, now)
  if ("problem" in d) return fail(T, target, d.problem)
  const note = str(args.note).slice(0, 200) || null
  return {
    title: r.direction === "SALE" ? T : "CRM 지급 기록", target,
    changes: [
      { label: word, before: null, after: `${d.date} · ${won(amount)}${note ? ` · ${note}` : ""}` },
      { label: r.direction === "SALE" ? "받은 금액" : "준 금액", before: won(r.paid), after: won(r.paid + amount) },
      { label: "남은 금액", before: won(r.remaining), after: won(r.remaining - amount) },
    ],
    risk: `세금계산서에 ${word} 한 줄이 남아 미수금 · 미지급 화면이 바뀝니다. 활동 기록에 내 이름으로 남습니다. 잘못 적었으면 CRM › 입금에서 그 줄을 지웁니다.`,
    op: { kind: "payment", input: { invoiceId: r.invoiceId, paidOn: d.date, amountKrw: amount, note } },
  }
}

/** MCP · 질문 경로에 돌려줄 미리보기 글 */
export function crmPlanText(p: CrmPlan): string {
  return [
    `${p.title} — ${p.target}`,
    ...p.changes.map((c) => `- ${c.label}: ${c.before !== null ? `${c.before} → ${c.after}` : c.after}`),
    p.warning ? `⚠ ${p.warning}` : null,
    p.risk ? `(${p.risk})` : null,
  ].filter(Boolean).join("\n")
}
