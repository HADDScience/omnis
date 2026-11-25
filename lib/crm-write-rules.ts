// CRM 고치기 도구 — 정의 · 입력 읽기 · 「무엇이 어떻게 바뀌나」 계획. DB 를 직접 읽지 않는다(CrmPort 로 받는다) — 시험이 스텁을 넣는다.
// 쓰기는 lib/crm-write-tools.ts 가 화면 API 와 같은 서버 함수(lib/crm-ops.ts)로 한다.
//
// 모든 쓰기는 record_sample 과 같은 방식이다:
//   MCP      — confirm=true 일 때만 쓴다. 없으면 이 계획을 미리보기로 돌려준다
//   앱 AI    — 이 계획이 확인 카드(바뀌기 전 → 뒤, 재고 변화, 0 이하 경고)가 되고, 확인하면 confirm=true 로 실행한다
//   질문 경로 — 미리보기만(confirm 칸이 없다)
// 대상은 ID(또는 코드)로 고른다 — list_samples · find_org · list_products 로 찾는다. 이름이 여럿 걸리면 후보를 돌려주고 묻게 한다.
import {
  CONC_MAX, CONC_MIN, concText, gelShortWarning, lotMl, mlText, parseConc, parseMl, variantLabel,
} from "@/lib/crm-gel"
import { ORG_TYPE_LABEL, QUOTE_STATUS_LABEL, quoteTotals, SHIPMENT_KIND_LABEL, SHIPMENT_STATUS_LABEL } from "@/lib/crm"
import {
  kstToday, normalizeOrgName, pickOrg, productLabel, rankOrgs, resolveProduct, stockText, stockWarning, variantProductLabel,
  type ProductRow,
} from "@/lib/crm-sample-rules"

// ─── 도구 정의(MCP inputSchema) ─────────────────────────────────────

const CONFIRM = { type: "boolean", description: "사용자가 바뀔 내용에 동의했으면 true. 없으면 쓰지 않고 미리보기만 돌려준다" } as const
const DATE = { type: "string", description: "날짜 YYYY-MM-DD(서울). 비우면 오늘. 앞날은 안 된다" } as const
const ORG_TYPE = { type: "string", enum: ["UNIVERSITY", "RESEARCH", "COMPANY", "HOSPITAL", "OTHER"], description: "기관 종류 — 대학 · 연구원 · 기업 · 병원 · 기타" } as const
const CONCENTRATION = { type: "number", description: "젤 타입(애드젤 · 라이브젤)일 때 농도 % (0.5~20). list_products 에 농도별 재고가 있다" } as const
const VOLUME_ML = { type: "number", description: "젤 타입일 때 ml(양수). 젤은 개수를 세지 않는다 — 5ml 짜리 3개를 보냈으면 volume_ml=15, quantity 는 비운다" } as const
/** 견적 품목만은 개수 × 단가로 남긴다 — 한 개 용량 */
const QUOTE_VOLUME_ML = { type: "number", description: "젤 타입일 때 한 개 용량(ml, 양수) — 견적은 개수 × 단가로 적는다. 5ml 짜리 3개면 volume_ml=5, quantity=3" } as const
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
      "딸린 샘플 출고가 따라간다: 수량(젤 타입은 volume_ml 의 ml)을 바꾸면 출고와 재고가, 제품을 바꾸면 출고 · 재고의 제품이 바뀐다. quantity=0 이면 샘플 출고를 지워 재고를 되돌린다. " +
      "sample_id 는 list_samples 로 찾는다. 제품은 list_products 의 product_id. " + PREVIEW_RULE,
    inputSchema: {
      type: "object",
      properties: {
        sample_id: { type: "string", description: "list_samples 의 sample_id(또는 샘플 코드)" },
        date: { type: "string", description: "전달한 날 YYYY-MM-DD. 출고 날짜도 함께 바뀐다" },
        org: { type: "string", description: "기관을 바꿀 때 — find_org 의 기관 코드(ORG001) · 이름" },
        product_id: { type: "string", description: "제품을 바꿀 때 — list_products 의 product_id(또는 코드). 'none' 이면 제품을 비우고 샘플 출고를 지운다" },
        quantity: { type: "integer", description: "샘플 출고 수량(개) — 젤 타입이 아닌 제품만(젤은 volume_ml). 0 이면 출고를 지워 재고를 되돌린다" },
        concentration: CONCENTRATION,
        volume_ml: VOLUME_ML,
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
        quantity: { type: "number", description: "in · out 은 움직인 양, count 는 세어 본 실제 재고. 단위는 제품 단위(개 · g). 젤 타입은 ml" },
        concentration: { ...CONCENTRATION, description: "젤 타입이면 필수 — 어느 농도 칸인가(%)" },
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
      "CRM 생산 한 건 — 젤 타입(애드젤 ADDGEL · 라이브젤 LIVEGEL) · 농도 · 만든 ml. 개수는 세지 않는다. 그 농도의 완제품 재고(ml)가 늘고, 타입에 이어진 원재료(예: DNA)가 농도/100 × ml(g, 농도는 g/100ml)만큼 준다(한 번에). " +
      "원재료가 모자라도 기록하고 경고한다. " + PREVIEW_RULE,
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["ADDGEL", "LIVEGEL"], description: "제품 타입 — ADDGEL 애드젤 · LIVEGEL 라이브젤" },
        concentration: { type: "number", description: "농도 % (0.5~20)" },
        volume_ml: { type: "number", description: "만든 양(ml, 양수) — 5ml 3개 + 2ml 5개를 만들었으면 25" },
        date: DATE,
        note: { type: "string", description: "메모 — 로트 등" },
        material_id: { type: "string", description: "원재료를 바꿀 때만 — list_products 의 원료(g) product_id. 'none' 이면 차감하지 않는다. 비우면 타입별 기본 원재료" },
        confirm: CONFIRM,
      },
      required: ["type", "concentration", "volume_ml"],
    },
  },
  {
    name: "list_productions",
    description: "CRM 생산 기록 목록 — production_id · MFG 코드 · 날짜 · 타입 · 농도 · 만든 ml · 원재료 차감. 최근 것부터. 생산을 고치거나 지우려면 먼저 이것으로 production_id 를 찾는다.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "MFG 코드 · 타입 이름 · 메모 일부. 비우면 최근 것" },
        limit: { type: "integer", description: "기본 20, 최대 50" },
      },
    },
  },
  {
    name: "update_production",
    description:
      "CRM 생산 기록 한 건을 고친다 — 타입 · 농도 · 만든 ml · 날짜 · 메모 · 원재료. 준 칸만 바뀌고, 그 생산의 재고 장부 줄을 다시 만들어 완제품 재고와 원재료 차감이 다시 계산된다. " +
      "production_id 는 list_productions 로 찾는다. " + PREVIEW_RULE,
    inputSchema: {
      type: "object",
      properties: {
        production_id: { type: "string", description: "list_productions 의 production_id(또는 MFG 코드)" },
        type: { type: "string", enum: ["ADDGEL", "LIVEGEL"], description: "제품 타입을 바꿀 때" },
        concentration: { type: "number", description: "농도 % (0.5~20)" },
        volume_ml: { type: "number", description: "만든 양(ml)" },
        date: DATE,
        note: { type: "string", description: "메모" },
        material_id: { type: "string", description: "원재료 — 원료 product_id, 'none' 이면 차감 안 함" },
        confirm: CONFIRM,
      },
      required: ["production_id"],
    },
  },
  {
    name: "delete_production",
    description:
      "CRM 생산 기록 한 건을 지운다 — 그 생산에서 나온 재고 장부 줄이 함께 사라져 완제품은 빠지고 원재료는 돌아온다(생산 전으로 되돌림). production_id 는 list_productions 로 찾는다. " + PREVIEW_RULE,
    inputSchema: {
      type: "object",
      properties: {
        production_id: { type: "string", description: "list_productions 의 production_id(또는 MFG 코드)" },
        confirm: CONFIRM,
      },
      required: ["production_id"],
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
              quantity: { type: "integer", description: "수량(젤 타입은 한 개 용량 volume_ml 의 개수)" },
              unit_price: { type: "integer", description: "단가(원, 부가세 별도). 비우면 제품 기본 단가(젤 타입은 기본 단가가 없어 직접 준다)" },
              concentration: CONCENTRATION,
              volume_ml: QUOTE_VOLUME_ML,
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
      "CRM 견적의 상태 · 비고 · 세금계산서 발행일을 고친다(화면과 같다 — 품목을 바꾸려면 지우고 새로 만든다). 완료(DONE)로 바꾸고 세금계산서가 없으면 재무 담당에게 발행 요청 알림이 간다. " +
      "quote_id 는 list_quotes 로 찾는다. " + PREVIEW_RULE,
    inputSchema: {
      type: "object",
      properties: {
        quote_id: { type: "string", description: "list_quotes 의 quote_id(또는 견적 코드)" },
        status: { type: "string", enum: ["DRAFT", "SENT", "DONE", "CANCELLED"], description: "작성중 · 발송 · 완료 · 취소" },
        note: { type: "string", description: "비고" },
        tax_invoiced_at: { type: "string", description: "세금계산서 발행일 YYYY-MM-DD. 빈 문자열이면 지운다(화면 견적 상세와 같다)" },
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
        quantity: { type: "integer", description: "수량(개) — 젤 타입이 아닌 제품만. 젤 타입은 volume_ml(ml)" },
        concentration: CONCENTRATION,
        volume_ml: VOLUME_ML,
        kind: { type: "string", enum: ["SALE", "SAMPLE", "GIFT"], description: "판매(기본) · 샘플 · 증정" },
        status: { type: "string", enum: ["PREPARING", "SHIPPING", "DELIVERED"], description: "준비중 · 배송중 · 배송완료(기본)" },
        quote_id: { type: "string", description: "이어지는 견적(있으면)" },
        date: DATE,
        note: { type: "string", description: "비고 — 송장번호 등" },
        confirm: CONFIRM,
      },
      required: ["org", "product_id"],
    },
  },
  {
    name: "list_shipments",
    description: "CRM 출고(출하) 목록 — shipment_id · SH 코드 · 날짜 · 기관 · 제품(젤은 농도) · 나간 양(젤 ml · 아니면 개수) · 유형 · 상태 · 재고 반영 여부. 최근 것부터. 출고를 고치거나 지우려면 먼저 이것으로 shipment_id 를 찾는다.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "SH 코드 · 기관 이름 · 기관 코드 · 제품 이름 · 메모 일부. 비우면 최근 것" },
        limit: { type: "integer", description: "기본 20, 최대 50" },
      },
    },
  },
  {
    name: "update_shipment",
    description:
      "CRM 출고 한 건을 고친다 — 제품 · 농도 · 나간 ml(젤) · 개수(젤이 아닌 제품) · 기관 · 날짜 · 유형 · 상태 · 비고. 준 칸만 바뀌고, 재고에 반영된 출고면 그 출고의 재고 장부 줄을 다시 만들어 재고가 다시 계산된다(다른 농도 칸 · 다른 제품으로 옮겨도). " +
      "엑셀에서 넘어온 「미반영」 출고는 고쳐도 재고가 바뀌지 않는다. 샘플요청에서 나온 출고의 기관 · 제품은 update_sample 로 고친다. shipment_id 는 list_shipments 로 찾는다. " + PREVIEW_RULE,
    inputSchema: {
      type: "object",
      properties: {
        shipment_id: { type: "string", description: "list_shipments 의 shipment_id(또는 SH 코드)" },
        product_id: { type: "string", description: "제품을 바꿀 때 — list_products 의 product_id(또는 코드)" },
        concentration: CONCENTRATION,
        volume_ml: { type: "number", description: "젤 타입 출고의 나간 ml 전체(5ml 3개면 15)" },
        quantity: { type: "integer", description: "개수 — 젤 타입이 아닌 출고만" },
        org: { type: "string", description: "받는 기관을 바꿀 때 — 기관 코드(ORG001) · 이름" },
        kind: { type: "string", enum: ["SALE", "SAMPLE", "GIFT"], description: "판매 · 샘플 · 증정" },
        status: { type: "string", enum: ["PREPARING", "SHIPPING", "DELIVERED"], description: "준비중 · 배송중 · 배송완료" },
        date: DATE,
        note: { type: "string", description: "비고 — 송장번호 등. 빈 문자열이면 지운다" },
        confirm: CONFIRM,
      },
      required: ["shipment_id"],
    },
  },
  {
    name: "delete_shipment",
    description:
      "CRM 출고 한 건을 지운다 — 그 출고에서 나온 재고 장부 줄이 함께 사라져 재고가 출고 전으로 돌아온다(미반영 출고는 재고가 그대로). shipment_id 는 list_shipments 로 찾는다. " + PREVIEW_RULE,
    inputSchema: {
      type: "object",
      properties: {
        shipment_id: { type: "string", description: "list_shipments 의 shipment_id(또는 SH 코드)" },
        confirm: CONFIRM,
      },
      required: ["shipment_id"],
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
export const CRM_READ_NAMES = ["list_samples", "list_quotes", "list_receivables", "list_productions", "list_shipments"] as const
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
  /** 젤 타입 출고는 quantity 가 비고 volumeMl 이 출고 ml */
  shipments: { id: string; code: string; quantity: number | null; productId: string; concentrationPct?: number | null; volumeMl?: number | null }[]
  /** 젤 타입 제품이면 농도 · 보낸 ml */
  concentrationPct?: number | null
  volumeMl?: number | null
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
  /** 세금계산서 발행일 YYYY-MM-DD(KST) — 없으면 null */
  taxInvoicedAt?: string | null
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
  /** 생산 id 또는 MFG 코드로 */
  production(ref: string): Promise<CrmProductionView | null>
  /** 생산 입력 계산(쓰지 않는다) — 화면 · 실제 쓰기와 같은 함수(lib/crm-ops.ts planProductionInput). excludeId: 고치기면 그 생산분을 빼고 본다 */
  productionPreview(input: Record<string, unknown>, excludeId?: string): Promise<ProductionPreview | { problem: string }>
  /** 출고 id 또는 SH 코드로 */
  shipment(ref: string): Promise<CrmShipmentView | null>
}

export interface CrmShipmentView {
  id: string
  code: string
  /** YYYY-MM-DD(서울) */
  date: string
  kind: keyof typeof SHIPMENT_KIND_LABEL
  status: keyof typeof SHIPMENT_STATUS_LABEL
  org: { id: string; name: string }
  productId: string
  /** 젤 출고 — 농도 · 나간 ml. 개수는 비어 있다 */
  concentrationPct: number | null
  volumeMl: number | null
  /** 젤이 아닌 출고 개수 */
  quantity: number | null
  note: string | null
  /** 재고에 반영된 출고(장부 줄이 있다). 엑셀에서 넘어온 지난 출고는 false */
  ledger: boolean
  /** 샘플요청에서 나온 출고면 그 코드 */
  sampleCode: string | null
}

export interface CrmProductionView {
  id: string
  code: string
  date: string
  productId: string
  productName: string
  concentrationPct: number | null
  totalMl: number
  materialId: string | null
  materialName: string | null
  materialGrams: number
  note: string | null
  photoFileIds: string[]
}

export interface ProductionPreview {
  productId: string
  productName: string
  conc: number
  totalMl: number
  materialId: string | null
  materialName: string | null
  materialGrams: number
  /** 원재료 현재고(g) — 고치기면 이 생산이 뺀 것을 돌려놓은 값 */
  materialBefore: number
  warnings: string[]
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
  | { kind: "stockMove"; input: { movedAt: string; productId: string; direction: "IN" | "OUT"; quantity: number; note: string | null; concentrationPct?: number | null } }
  /** input 은 화면 POST /api/crm/productions 와 같은 모양(lib/crm-ops.ts productionSchema) */
  | { kind: "production"; input: Record<string, unknown> }
  | { kind: "updateProduction"; id: string; input: Record<string, unknown> }
  | { kind: "deleteProduction"; id: string }
  | { kind: "createQuote"; input: { quotedAt: string; orgId: string; discountAmount: number; status: "DRAFT" | "SENT"; note: string | null; items: { productId: string; quantity: number; unitPrice: number; concentrationPct?: number | null; volumeMl?: number | null }[] } }
  | { kind: "updateQuote"; id: string; input: { status?: string; note?: string | null; taxInvoicedAt?: string | null } }
  | { kind: "deleteQuote"; id: string }
  | { kind: "updateShipment"; id: string; input: Record<string, unknown> }
  | { kind: "deleteShipment"; id: string }
  | { kind: "shipment"; input: { shippedAt: string; kind: string; orgId: string; productId: string; quantity: number | null; status: string; quoteId: string | null; note: string | null; concentrationPct?: number | null; volumeMl?: number | null } }
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

/** 젤 타입의 칸 — 농도(%) · ml(출고 · 샘플은 총량, 견적은 한 개 용량). 젤이 아니면 둘 다 null */
export interface Variant {
  conc: number | null
  vol: number | null
}

/**
 * 젤 타입 제품의 농도 · ml 읽기 — 준 값(concentration · volume_ml), 없으면 fallback.
 * needVolume 이면 ml 까지 있어야 한다. 출고 · 샘플은 그 ml(총량)가 그 농도 칸에서 빠지고, 견적은 한 개 용량이다.
 */
function parseVariant(p: CrmProductRow, args: Record<string, unknown>, fallback: Variant, needVolume: boolean): { variant: Variant } | { problem: string } {
  if (!p.gelType) return { variant: { conc: null, vol: null } }
  const rawC = has(args, "concentration") ? args.concentration : fallback.conc
  if (rawC == null) return { problem: `${p.name} 은 젤 타입이라 concentration(농도 %, ${CONC_MIN}~${CONC_MAX})이 필요합니다 — list_products 에 농도별 재고가 있습니다.` }
  const c = parseConc(rawC)
  if ("problem" in c) return { problem: c.problem }
  const rawV = has(args, "volume_ml") ? args.volume_ml : fallback.vol
  if (rawV == null) {
    if (needVolume) return { problem: `${p.name} 은 젤 타입이라 volume_ml(ml)이 필요합니다.` }
    return { variant: { conc: c.conc, vol: null } }
  }
  const m = parseMl(rawV)
  if ("problem" in m) return { problem: m.problem }
  return { variant: { conc: c.conc, vol: m.ml } }
}

/**
 * 재고 변화 줄들 — delta 는 제품 단위의 양(늘면 +, 줄면 −). 젤 타입은 (제품, 농도) 칸의 ml, 아니면 개 · g.
 * 같은 칸의 변화는 합쳐 한 줄로 보인다(샘플 수량만 고치면 「−2개」 한 줄).
 */
function stockEffects(items: { p: CrmProductRow; v: Variant; delta: number }[]): { rows: CrmChange[]; warnings: (string | null)[] } {
  const keyed = new Map<string, { p: CrmProductRow; v: Variant; delta: number }>()
  for (const it of items) {
    const gel = Boolean(it.p.gelType)
    const key = gel ? `${it.p.id}@${it.v.conc}` : it.p.id
    const delta = round3(it.delta)
    const cur = keyed.get(key)
    if (cur) cur.delta = round3(cur.delta + delta)
    else keyed.set(key, { p: it.p, v: it.v, delta })
  }
  const rows: CrmChange[] = []
  const warnings: (string | null)[] = []
  for (const { p, v, delta } of keyed.values()) {
    if (p.gelType && v.conc != null) {
      const before = lotMl(p.lots ?? [], v.conc)
      const after = round3(before + delta)
      rows.push({ label: `재고 · ${variantLabel(p.name, v.conc)}`, before: mlText(before), after: mlText(after) })
      if (delta < 0) warnings.push(gelShortWarning(variantLabel(p.name, v.conc), before, -delta))
    } else {
      const e = stockEffect(p, delta)
      rows.push(e.row)
      warnings.push(e.warning)
    }
  }
  return { rows, warnings }
}

// ─── 도구별 계획 ─────────────────────────────────────────────────────

export async function planCrmWrite(name: CrmWriteToolName, args: Record<string, unknown>, port: CrmPort, now = new Date()): Promise<CrmPlan> {
  switch (name) {
    case "update_sample": return planUpdateSample(args, port, now)
    case "delete_sample": return planDeleteSample(args, port)
    case "create_org": return planCreateOrg(args, port)
    case "update_org": return planUpdateOrg(args, port)
    case "record_stock": return planStock(args, port, now)
    case "record_production": return planProduction(args, port, now)
    case "update_production": return planUpdateProduction(args, port, now)
    case "delete_production": return planDeleteProduction(args, port)
    case "create_quote": return planCreateQuote(args, port, now)
    case "update_quote": return planUpdateQuote(args, port)
    case "delete_quote": return planDeleteQuote(args, port)
    case "record_shipment": return planShipment(args, port, now)
    case "update_shipment": return planUpdateShipment(args, port, now)
    case "delete_shipment": return planDeleteShipment(args, port)
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

  // 제품 · 수량 · (젤이면) 농도 · 용량 — 딸린 샘플 출고와 재고가 따라간다
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
  // 젤 타입은 개수를 세지 않는다 — 출고 양은 ml(volume_ml). 아니면 개(quantity). quantity=0 은 둘 다 출고 지우기
  const isGel = Boolean(newProduct?.gelType)
  let qty: number | null = ship ? ship.quantity : null
  if (has(args, "quantity")) {
    const n = Number(args.quantity)
    if (!Number.isInteger(n) || n < 0 || n > 10000) return fail(T, target, "quantity 는 0~10000 의 정수입니다(0 이면 샘플 출고를 지웁니다).")
    if (isGel && n > 0) return fail(T, target, `${newProduct!.name} 은 젤 타입이라 개수를 세지 않습니다 — volume_ml(보낸 ml)로 적어 주세요.`)
    qty = n
  }
  const productChanged = (newProduct?.id ?? null) !== (s.productId ?? null)
  const oldVariant: Variant = { conc: s.concentrationPct ?? ship?.concentrationPct ?? null, vol: s.volumeMl ?? ship?.volumeMl ?? null }
  let newVariant: Variant = isGel && !productChanged ? oldVariant : { conc: null, vol: null }
  if (isGel) {
    const v = parseVariant(newProduct!, args, { conc: productChanged ? null : oldVariant.conc, vol: productChanged ? null : oldVariant.vol }, Boolean(ship) && qty !== 0)
    if ("problem" in v) return fail(T, target, v.problem)
    newVariant = v.variant
  }
  const concChanged = isGel && newVariant.conc !== oldVariant.conc
  const mlChanged = isGel && newVariant.vol !== oldVariant.vol
  const qtyChanged = has(args, "quantity") && qty !== (ship ? ship.quantity : null)
  const removeShip = Boolean(ship) && (qty === 0 || newProduct === null)
  if ((productChanged || qtyChanged || concChanged || mlChanged) && s.shipments.length > 1) {
    return fail(T, target, `이 샘플요청에 출고가 ${s.shipments.length}건(${s.shipments.map((x) => x.code).join(", ")}) 있습니다 — 수량 · 제품은 CRM › 출고에서 출고마다 고쳐 주세요.`)
  }
  if (ship && newProduct && !isGel && !removeShip && !qty) return fail(T, target, `${productLabel(newProduct)} 은 개수로 셉니다 — quantity 를 함께 주세요.`)
  if (productChanged || concChanged) {
    if (productChanged) input.productId = newProduct ? newProduct.id : null
    changes.push({
      label: "제품",
      before: oldProduct ? variantProductLabel(oldProduct, oldVariant.conc, null) : "(없음)",
      after: newProduct ? variantProductLabel(newProduct, newVariant.conc, null) : "(없음 — 샘플 출고를 지웁니다)",
    })
  }
  if (isGel && (productChanged || concChanged || mlChanged || (!ship && has(args, "volume_ml")))) { input.concentrationPct = newVariant.conc; input.volumeMl = newVariant.vol }
  if (qtyChanged && qty !== null) input.quantity = qty
  // 재고 계산 — 원래 출고분을 되돌리고 새 출고분을 뺀다(같은 칸이면 한 줄로 합친다)
  const shipProduct = ship ? byId.get(ship.productId) ?? null : null
  const shipVariant: Variant = { conc: ship?.concentrationPct ?? null, vol: ship?.volumeMl ?? null }
  const amountOf = (p: CrmProductRow, v: Variant, n: number | null) => (p.gelType ? v.vol ?? 0 : n ?? 0)
  const amountWord = (p: CrmProductRow, v: Variant, n: number) => (p.gelType ? variantProductLabel(p, v.conc, n) : `${productLabel(p)} ${n}개`)
  if (ship && shipProduct && (productChanged || qtyChanged || concChanged || mlChanged)) {
    const oldAmt = amountOf(shipProduct, shipVariant, ship.quantity)
    if (removeShip) {
      changes.push({ label: "샘플 출고", before: `${ship.code} · ${amountWord(shipProduct, shipVariant, oldAmt)}`, after: "지웁니다 — 재고가 돌아옵니다" })
      changes.push(...stockEffects([{ p: shipProduct, v: shipVariant, delta: oldAmt }]).rows)
    } else if (newProduct) {
      const newAmt = amountOf(newProduct, newVariant, qty)
      // 같은 칸(제품 · 농도)이면 양만 보인다 — 「SH101 · 3개 → 1개」, 젤은 「SH103 · 4ml → 6ml」
      const sameRow = newProduct.id === shipProduct.id && newVariant.conc === shipVariant.conc
      const amt = (p: CrmProductRow, n: number) => (p.gelType ? mlText(n) : `${n}개`)
      changes.push(sameRow
        ? { label: "샘플 출고", before: `${ship.code} · ${amt(shipProduct, oldAmt)}`, after: amt(newProduct, newAmt) }
        : { label: "샘플 출고", before: `${ship.code} · ${amountWord(shipProduct, shipVariant, oldAmt)}`, after: amountWord(newProduct, newVariant, newAmt) })
      const e = stockEffects([{ p: shipProduct, v: shipVariant, delta: oldAmt }, { p: newProduct, v: newVariant, delta: -newAmt }])
      changes.push(...e.rows); warnings.push(...e.warnings)
    }
  } else if (!ship && newProduct && (isGel ? has(args, "volume_ml") && newVariant.vol != null : Boolean(qty && qty > 0))) {
    const newAmt = amountOf(newProduct, newVariant, qty)
    changes.push({ label: "샘플 출고", before: null, after: `${amountWord(newProduct, newVariant, newAmt)} — 새로 남깁니다` })
    const e = stockEffects([{ p: newProduct, v: newVariant, delta: -newAmt }])
    changes.push(...e.rows); warnings.push(...e.warnings)
  } else if (!ship && !newProduct && qty && qty > 0) {
    return fail(T, target, "이 샘플요청에는 제품이 없어 샘플 출고를 만들 수 없습니다 — product_id 를 함께 주세요(list_products).")
  }
  if (changes.length === 0) return fail(T, target, "바뀌는 것이 없습니다 — 고칠 칸(date · org · product_id · quantity · volume_ml · content · referral · note · sent)을 주세요.")
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
      const what = p?.gelType ? variantProductLabel(p, sh.concentrationPct ?? null, sh.volumeMl ?? null) : `${p ? productLabel(p) : "제품"} ${sh.quantity ?? 0}개`
      changes.push({ label: "샘플 출고", before: `${sh.code} · ${what}`, after: keep ? "남깁니다(연결만 끊김)" : "지웁니다" })
    }
    if (!keep) {
      // 같은 칸(제품 · 젤이면 농도) 출고가 여럿이면 합쳐서 한 줄
      const back = s.shipments.flatMap((sh) => {
        const p = products.get(sh.productId)
        if (!p) return []
        const v = { conc: sh.concentrationPct ?? null, vol: sh.volumeMl ?? null }
        return [{ p, v, delta: p.gelType ? v.vol ?? 0 : sh.quantity ?? 0 }]
      })
      changes.push(...stockEffects(back).rows)
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
  if (p.gelType) return planGelStock(T, mode, p, args, now)
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

/**
 * 젤 타입 재고 맞추기 — (타입, 농도) 칸에 ml 로 적는다. 개수는 세지 않는다.
 * count(실사)는 세어 본 그 칸의 ml 를 준다.
 */
function planGelStock(T: string, mode: string, p: CrmProductRow, args: Record<string, unknown>, now: Date): CrmPlan {
  const v = parseVariant(p, args, { conc: null, vol: null }, false)
  if ("problem" in v) return fail(T, p.name, v.problem)
  const conc = v.variant.conc!
  const target = `${variantLabel(p.name, conc)} (${p.code})`
  const n = Number(args.quantity)
  if (!Number.isFinite(n) || n < 0 || (mode !== "count" && n === 0)) return fail(T, target, mode === "count" ? "quantity(세어 본 재고 ml)는 0 이상입니다." : "quantity(ml)는 0보다 커야 합니다.")
  const d = parseDate(args.date, now)
  if ("problem" in d) return fail(T, target, d.problem)
  const before = lotMl(p.lots ?? [], conc)
  let direction: "IN" | "OUT" = mode === "out" ? "OUT" : "IN"
  let ml = round3(n)
  if (mode === "count") {
    const diff = round3(n - before)
    if (diff === 0) return fail(T, target, `장부 재고가 이미 ${mlText(before)}입니다 — 맞출 것이 없습니다.`)
    direction = diff > 0 ? "IN" : "OUT"
    ml = Math.abs(diff)
  }
  const note = str(args.note).slice(0, 500) || (mode === "count" ? `실사 보정(세어 본 재고 ${mlText(n)})` : null)
  const e = stockEffects([{ p, v: { conc, vol: null }, delta: direction === "IN" ? ml : -ml }])
  return {
    title: T, target,
    changes: [
      { label: "장부 한 줄", before: null, after: `${d.date} · ${direction === "IN" ? "입고" : "출고"} ${mlText(ml)}${note ? ` · ${note}` : ""}` },
      ...e.rows,
    ],
    warning: mode === "count" ? null : joinWarn(e.warnings),
    risk: "CRM 재고 장부에 한 줄이 생겨 이 농도의 재고가 바뀝니다. 활동 기록에 내 이름으로 남습니다. 잘못 적었으면 CRM › 재고에서 그 줄을 지웁니다.",
    op: { kind: "stockMove", input: { movedAt: d.date, productId: p.id, direction, quantity: ml, note, concentrationPct: conc } },
    done: { entity: "crm.stock", action: "create", title: `재고 ${direction === "IN" ? "입고" : "출고"} ${variantLabel(p.name, conc)} ${mlText(ml)}` },
  }
}

/** 도구 입력 → 생산 입력(화면 POST /api/crm/productions 와 같은 모양) */
function productionInputFromArgs(args: Record<string, unknown>, products: CrmProductRow[], date: string, fallback?: CrmProductionView): { input: Record<string, unknown> } | { problem: string } {
  let productId = fallback?.productId ?? null
  const typeArg = str(args.type || args.product_id)
  if (typeArg) {
    const t = typeArg.toUpperCase().replace(/[^A-Z가-힣]/g, "")
    const gel = products.find((p) => p.gelType && (p.id === typeArg || p.code.toUpperCase() === typeArg.toUpperCase() || p.gelType === t || (t.includes("애드") && p.gelType === "ADDGEL") || (t.includes("라이브") && p.gelType === "LIVEGEL") || (t.includes("ADD") && p.gelType === "ADDGEL") || (t.includes("LIVE") && p.gelType === "LIVEGEL")))
    if (!gel) return { problem: `type 은 애드젤(ADDGEL) · 라이브젤(LIVEGEL) 중 하나입니다 — 받은 값 '${typeArg}'.` }
    productId = gel.id
  }
  if (!productId) return { problem: "type(애드젤 ADDGEL · 라이브젤 LIVEGEL)이 비어 있습니다." }
  const conc = has(args, "concentration") ? args.concentration : fallback?.concentrationPct
  if (conc == null) return { problem: `concentration(농도 %, ${CONC_MIN}~${CONC_MAX})이 비어 있습니다.` }
  const totalMl = has(args, "volume_ml") ? args.volume_ml : fallback?.totalMl
  if (totalMl == null || totalMl === "") return { problem: "volume_ml(만든 ml)가 비어 있습니다 — 예: 5ml 3개 + 2ml 5개를 만들었으면 25." }
  const material = has(args, "material_id") ? (NONE.test(str(args.material_id)) ? "none" : str(args.material_id)) : fallback?.materialId ?? undefined
  if (material && material !== "none") {
    const m = products.find((p) => p.isMaterial && (p.id === material || p.code.toUpperCase() === material.toUpperCase()))
    if (!m) return { problem: `원재료 '${material}' 가 없습니다 — list_products 에서 원료(g 단위) 줄의 product_id 를 고르세요.` }
  }
  const materialId = material && material !== "none" ? products.find((p) => p.isMaterial && (p.id === material || p.code.toUpperCase() === material.toUpperCase()))!.id : material
  return {
    input: {
      producedAt: date, productId, concentrationPct: conc, totalMl,
      ...(materialId !== undefined ? { materialId } : {}),
      note: has(args, "note") ? str(args.note).slice(0, 2000) || null : fallback?.note ?? null,
      photoFileIds: fallback?.photoFileIds ?? [],
    },
  }
}

const productionRows = (pl: ProductionPreview, date: string, note: string | null): CrmChange[] => [
  { label: "생산", before: null, after: `${date} · ${variantLabel(pl.productName, pl.conc, pl.totalMl)}${note ? ` · ${note}` : ""}` },
  { label: "원재료 차감", before: null, after: pl.materialName ? `${pl.materialName} ${pl.materialGrams}g (${concText(pl.conc)} × ${mlText(pl.totalMl)}, 농도는 g/100ml)` : "없음 — 이 타입에 이어진 원재료가 없습니다" },
]

async function planProduction(args: Record<string, unknown>, port: CrmPort, now: Date): Promise<CrmPlan> {
  const T = "CRM 생산 기록"
  const products = await port.products()
  const d = parseDate(args.date, now)
  if ("problem" in d) return fail(T, "(생산)", d.problem)
  const ir = productionInputFromArgs(args, products, d.date)
  if ("problem" in ir) return fail(T, str(args.type) || "(타입 없음)", ir.problem)
  const pl = await port.productionPreview(ir.input)
  if ("problem" in pl) return fail(T, str(args.type) || "(생산)", pl.problem)
  const p = products.find((x) => x.id === pl.productId)!
  const target = `${variantLabel(pl.productName, pl.conc)} · ${d.date}`
  const note = (ir.input.note as string | null) ?? null
  const made = stockEffects([{ p, v: { conc: pl.conc, vol: null }, delta: pl.totalMl }])
  return {
    title: T, target,
    changes: [
      ...productionRows(pl, d.date, note),
      ...made.rows,
      ...(pl.materialName ? [{ label: `재고 · ${pl.materialName}`, before: `${pl.materialBefore}g`, after: `${round3(pl.materialBefore - pl.materialGrams)}g` }] : []),
    ],
    warning: joinWarn(pl.warnings),
    risk: "CRM 생산 기록 한 건이 생기고 그 농도의 완제품 재고는 늘고 원재료는 줍니다(한 번에). 활동 기록에 내 이름으로 남습니다. 잘못 적었으면 update_production · delete_production 이나 CRM › 재고 · 생산의 「고치기 · 지우기」로 바꿉니다(재고 · 원재료가 다시 계산됩니다).",
    op: { kind: "production", input: ir.input },
    done: { entity: "crm.production", action: "create", title: `생산 ${variantLabel(pl.productName, pl.conc)} ${mlText(pl.totalMl)}` },
  }
}

async function productionTarget(args: Record<string, unknown>, port: CrmPort, T: string): Promise<{ v: CrmProductionView } | { plan: CrmPlan }> {
  const ref = str(args.production_id)
  if (!ref) return { plan: fail(T, "(생산 없음)", "production_id 가 비어 있습니다 — list_productions 로 찾으세요.") }
  const v = await port.production(ref)
  if (!v) return { plan: fail(T, ref, `'${ref}' 생산 기록이 없습니다 — list_productions 로 production_id(또는 MFG 코드)를 확인하세요.`) }
  return { v }
}

const productionViewText = (v: CrmProductionView) =>
  `${v.code} · ${v.date} · ${variantLabel(v.productName, v.concentrationPct, v.totalMl)}${v.materialName ? ` · ${v.materialName} −${v.materialGrams}g` : ""}`

async function planUpdateProduction(args: Record<string, unknown>, port: CrmPort, now: Date): Promise<CrmPlan> {
  const T = "CRM 생산 기록 고치기"
  const t = await productionTarget(args, port, T)
  if ("plan" in t) return t.plan
  const v = t.v
  const products = await port.products()
  let date = v.date
  if (has(args, "date")) {
    const d = parseDate(args.date, now)
    if ("problem" in d) return fail(T, v.code, d.problem)
    date = d.date
  }
  const ir = productionInputFromArgs(args, products, date, v)
  if ("problem" in ir) return fail(T, v.code, ir.problem)
  const pl = await port.productionPreview(ir.input, v.id)
  if ("problem" in pl) return fail(T, v.code, pl.problem)
  const p = products.find((x) => x.id === pl.productId)!
  const oldP = products.find((x) => x.id === v.productId) ?? p
  const note = (ir.input.note as string | null) ?? null
  // 재고: 이 생산이 만든 것을 거두고 새로 더한다. 원재료: 뺀 것을 돌려주고 새로 뺀다
  const e = stockEffects([
    { p: oldP, v: { conc: v.concentrationPct, vol: null }, delta: -v.totalMl },
    { p, v: { conc: pl.conc, vol: null }, delta: pl.totalMl },
  ])
  const after = `${date} · ${variantLabel(pl.productName, pl.conc, pl.totalMl)}${note ? ` · ${note}` : ""}`
  const before = productionViewText(v)
  if (before === `${v.code} · ${after}${pl.materialName ? ` · ${pl.materialName} −${pl.materialGrams}g` : ""}` && note === v.note) {
    return fail(T, v.code, "바뀌는 것이 없습니다 — 고칠 칸(type · concentration · volume_ml · date · note · material_id)을 주세요.")
  }
  return {
    title: T, target: v.code,
    changes: [
      { label: "생산", before, after },
      { label: "원재료 차감", before: v.materialName ? `${v.materialName} ${v.materialGrams}g` : "없음", after: pl.materialName ? `${pl.materialName} ${pl.materialGrams}g` : "없음" },
      ...e.rows,
      ...(pl.materialName ? [{ label: `재고 · ${pl.materialName}`, before: `${round3(pl.materialBefore - (v.materialId === pl.materialId ? v.materialGrams : 0))}g`, after: `${round3(pl.materialBefore - pl.materialGrams)}g` }] : []),
    ],
    warning: joinWarn([...e.warnings, ...pl.warnings]),
    risk: "이 생산에서 나온 재고 장부 줄을 새 값으로 다시 만듭니다 — 완제품 재고와 원재료 차감이 다시 계산됩니다. 활동 기록에 내 이름으로 남습니다.",
    op: { kind: "updateProduction", id: v.id, input: ir.input },
    done: { entity: "crm.production", action: "update", title: `생산 고침 ${v.code} · ${variantLabel(pl.productName, pl.conc)} ${mlText(pl.totalMl)}` },
  }
}

async function planDeleteProduction(args: Record<string, unknown>, port: CrmPort): Promise<CrmPlan> {
  const T = "CRM 생산 기록 지우기"
  const t = await productionTarget(args, port, T)
  if ("plan" in t) return t.plan
  const v = t.v
  const products = await port.products()
  const p = products.find((x) => x.id === v.productId)
  const e = p ? stockEffects([{ p, v: { conc: v.concentrationPct, vol: null }, delta: -v.totalMl }]) : { rows: [], warnings: [] }
  const mat = v.materialId ? products.find((x) => x.id === v.materialId) : null
  return {
    title: T, target: v.code,
    changes: [
      { label: "지울 생산", before: productionViewText(v), after: "지움" },
      ...e.rows,
      ...(mat && v.materialGrams ? [{ label: `재고 · ${productLabel(mat)}`, before: stockText(mat.stock, mat.unit), after: stockText(round3(mat.stock + v.materialGrams), mat.unit) }] : []),
    ],
    warning: joinWarn(e.warnings),
    risk: "생산 기록과 그 생산에서 나온 재고 장부 줄을 지웁니다 — 완제품은 빠지고 원재료는 돌아옵니다(생산 전으로 되돌림). 되돌릴 수 없습니다. 활동 기록에 내 이름으로 남습니다.",
    op: { kind: "deleteProduction", id: v.id },
    done: { entity: "crm.production", action: "delete", title: `생산 지움 ${v.code} · ${variantLabel(v.productName, v.concentrationPct)} ${mlText(v.totalMl)}` },
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
  const items: { product: CrmProductRow; quantity: number; unitPrice: number; variant: Variant }[] = []
  for (const [i, it] of raw.entries()) {
    const r = (it ?? {}) as Record<string, unknown>
    const pr = productRef(str(r.product_id), products)
    if ("problem" in pr) return fail(T, target, `${i + 1}번째 품목: ${pr.problem}`)
    const q = Number(r.quantity)
    if (!Number.isInteger(q) || q < 1) return fail(T, target, `${i + 1}번째 품목: quantity 는 1 이상의 정수입니다.`)
    const vr = parseVariant(pr.product, r, { conc: null, vol: null }, true)
    if ("problem" in vr) return fail(T, target, `${i + 1}번째 품목: ${vr.problem}`)
    const price = has(r, "unit_price") ? Number(r.unit_price) : pr.product.gelType ? null : pr.product.unitPrice ?? null
    if (price === null) return fail(T, target, `${i + 1}번째 품목(${variantProductLabel(pr.product, vr.variant.conc, vr.variant.vol)})에 기본 단가가 없습니다 — unit_price 를 주세요.`)
    if (!Number.isInteger(price) || price < 0) return fail(T, target, `${i + 1}번째 품목: unit_price 는 0 이상의 정수(원)입니다.`)
    items.push({ product: pr.product, quantity: q, unitPrice: price, variant: vr.variant })
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
      ...items.map((it, i) => ({ label: `품목 ${i + 1}`, before: null, after: `${variantProductLabel(it.product, it.variant.conc, it.variant.vol)} ${it.quantity}개 × ${won(it.unitPrice)} = ${won(it.quantity * it.unitPrice)}` })),
      ...totalsRows(t),
      { label: "상태", before: null, after: QUOTE_STATUS_LABEL[status as "DRAFT"] },
      ...(note ? [{ label: "비고", before: null, after: note }] : []),
    ],
    warning: discount > t.supply ? `할인(${won(discount)})이 공급가보다 커서 공급가만큼만 깎입니다.` : null,
    risk: "CRM 견적 한 건이 생기고 견적 코드(HADD…)가 붙습니다. 재고는 바뀌지 않습니다(출하를 적을 때 빠집니다). 활동 기록에 내 이름으로 남습니다.",
    op: { kind: "createQuote", input: { quotedAt: d.date, orgId: o.org.id, discountAmount: discount, status, note, items: items.map((it) => ({ productId: it.product.id, quantity: it.quantity, unitPrice: it.unitPrice, ...(it.product.gelType ? { concentrationPct: it.variant.conc, volumeMl: it.variant.vol } : {}) })) } },
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
  const input: { status?: string; note?: string | null; taxInvoicedAt?: string | null } = {}
  if (has(args, "status")) {
    const st = str(args.status).toUpperCase()
    if (!(st in QUOTE_STATUS_LABEL)) return fail(T, target, "status 는 DRAFT · SENT · DONE · CANCELLED 중 하나입니다.")
    if (st !== q.status) { input.status = st; changes.push({ label: "상태", before: QUOTE_STATUS_LABEL[q.status], after: QUOTE_STATUS_LABEL[st as "DRAFT"] }) }
  }
  if (has(args, "note")) {
    const v = str(args.note).slice(0, 2000)
    if (v !== (q.note ?? "")) { input.note = v || null; changes.push({ label: "비고", before: q.note || "(없음)", after: v || "(비움)" }) }
  }
  if (has(args, "tax_invoiced_at")) {
    const raw = str(args.tax_invoiced_at)
    if (raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return fail(T, target, "tax_invoiced_at 은 YYYY-MM-DD 이거나 빈 문자열(지우기)입니다.")
    if (raw !== (q.taxInvoicedAt ?? "")) {
      input.taxInvoicedAt = raw ? `${raw}T00:00:00Z` : null
      changes.push({ label: "세금계산서 발행일", before: q.taxInvoicedAt || "(없음)", after: raw || "(지움)" })
    }
  }
  if (changes.length === 0) return fail(T, target, "바뀌는 것이 없습니다 — status · note · tax_invoiced_at 을 주세요(품목은 지우고 새로 만듭니다).")
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
  const vr = parseVariant(p, args, { conc: null, vol: null }, true)
  if ("problem" in vr) return fail(T, `${o.org.name} · ${productLabel(p)}`, vr.problem)
  const pv = vr.variant
  const target = `${o.org.name} · ${variantProductLabel(p, pv.conc, pv.vol)}`
  // 젤 타입은 개수를 세지 않는다 — volume_ml 가 출고 ml. 아니면 개수
  const q = p.gelType ? null : Number(args.quantity)
  if (q !== null && (!Number.isInteger(q) || q < 1)) return fail(T, target, "quantity 는 1 이상의 정수입니다.")
  if (p.gelType && has(args, "quantity") && Number(args.quantity) !== 1 && args.quantity != null && args.quantity !== "") {
    return fail(T, target, `${p.name} 은 젤 타입이라 개수를 세지 않습니다 — 나간 ml 전체를 volume_ml 로 적어 주세요(5ml 3개면 15).`)
  }
  const amount = p.gelType ? pv.vol! : q!
  const amountText = p.gelType ? variantProductLabel(p, pv.conc, pv.vol) : `${variantProductLabel(p, null, null)} ${q}개`
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
  const e = stockEffects([{ p, v: pv, delta: -amount }])
  return {
    title: T, target,
    changes: [
      { label: "출하", before: null, after: `${d.date} · ${o.org.name} · ${amountText} · ${SHIPMENT_KIND_LABEL[kind as "SALE"]} · ${SHIPMENT_STATUS_LABEL[status as "DELIVERED"]}` },
      ...(quote ? [{ label: "견적", before: null, after: quote.code }] : []),
      ...(note ? [{ label: "비고", before: null, after: note }] : []),
      ...e.rows,
    ],
    warning: joinWarn(e.warnings),
    risk: "CRM 출고 한 건과 그만큼 재고 출고가 함께 남습니다(한 번에). 활동 기록에 내 이름으로 남습니다. 잘못 적었으면 CRM › 출고에서 지우면 재고가 돌아옵니다.",
    op: { kind: "shipment", input: { shippedAt: d.date, kind, orgId: o.org.id, productId: p.id, quantity: q, status, quoteId: quote?.id ?? null, note, ...(p.gelType ? { concentrationPct: pv.conc, volumeMl: pv.vol } : {}) } },
    done: { entity: "crm.shipment", action: "create", title: `출하 ${o.org.name} · ${amountText}` },
  }
}

async function shipmentTarget(args: Record<string, unknown>, port: CrmPort, T: string): Promise<{ v: CrmShipmentView } | { plan: CrmPlan }> {
  const ref = str(args.shipment_id)
  if (!ref) return { plan: fail(T, "(출고 없음)", "shipment_id 가 비어 있습니다 — list_shipments 로 찾으세요.") }
  const v = await port.shipment(ref)
  if (!v) return { plan: fail(T, ref, `'${ref}' 출고가 없습니다 — list_shipments 로 shipment_id(또는 SH 코드)를 확인하세요.`) }
  return { v }
}

/** 출고 한 줄의 글 — 「SH101 · 2026-11-17 · 가나대학교 · 애드젤 (ADD GEL) · 1% · 4ml · 판매 · 배송완료」 */
function shipmentLine(date: string, org: string, p: CrmProductRow | undefined, v: Variant, quantity: number | null, kind: string, status: string, note: string | null) {
  const what = p?.gelType ? variantProductLabel(p, v.conc, v.vol) : `${p ? productLabel(p) : "제품"} ${quantity ?? 0}개`
  return `${date} · ${org} · ${what} · ${SHIPMENT_KIND_LABEL[kind as "SALE"] ?? kind} · ${SHIPMENT_STATUS_LABEL[status as "DELIVERED"] ?? status}${note ? ` · ${note}` : ""}`
}

/** 출고가 뺀 양 — 젤은 ml, 아니면 개 */
const shippedAmount = (p: CrmProductRow | undefined, v: { volumeMl: number | null; quantity: number | null }) => (p?.gelType ? v.volumeMl ?? 0 : v.quantity ?? 0)

async function planUpdateShipment(args: Record<string, unknown>, port: CrmPort, now: Date): Promise<CrmPlan> {
  const T = "CRM 출고 고치기"
  const t = await shipmentTarget(args, port, T)
  if ("plan" in t) return t.plan
  const s = t.v
  const products = await port.products()
  const oldP = products.find((x) => x.id === s.productId)
  const input: Record<string, unknown> = {}

  // 제품 — 샘플요청에서 나온 출고는 샘플요청에서 바꾼다
  let p = oldP
  if (has(args, "product_id")) {
    const pr = productRef(str(args.product_id), products)
    if ("problem" in pr) return fail(T, s.code, pr.problem)
    if (pr.product.id !== s.productId) {
      if (s.sampleCode) return fail(T, s.code, `샘플요청 ${s.sampleCode} 에서 나온 출고입니다 — 제품은 update_sample 로 고쳐 주세요.`)
      if (pr.product.isMaterial) return fail(T, s.code, `${pr.product.name} 은 원료입니다 — 출고는 완제품만 적습니다.`)
      p = pr.product
      input.productId = p.id
    }
  }
  if (!p) return fail(T, s.code, "이 출고의 제품을 찾지 못했습니다(보관된 제품일 수 있습니다) — CRM › 재고 · 출고 화면에서 고쳐 주세요.")
  const same = p.id === s.productId
  // 양 — 젤은 농도 · ml, 아니면 개수
  let v: Variant = { conc: null, vol: null }
  let quantity: number | null = null
  if (p.gelType) {
    if (has(args, "quantity") && Number(args.quantity) !== 1) return fail(T, s.code, `${p.name} 은 젤 타입이라 개수를 세지 않습니다 — 나간 ml 전체를 volume_ml 로 적어 주세요(5ml 3개면 15).`)
    const vr = parseVariant(p, args, same ? { conc: s.concentrationPct, vol: s.volumeMl } : { conc: null, vol: null }, true)
    if ("problem" in vr) return fail(T, s.code, vr.problem)
    v = vr.variant
    if (has(args, "concentration")) input.concentrationPct = v.conc
    if (has(args, "volume_ml") || !same) { input.volumeMl = v.vol; input.concentrationPct = v.conc }
  } else {
    if (has(args, "volume_ml") || has(args, "concentration")) return fail(T, s.code, "concentration · volume_ml 는 젤 타입(애드젤 · 라이브젤) 출고에만 씁니다 — quantity(개수)로 고쳐 주세요.")
    quantity = has(args, "quantity") ? Number(args.quantity) : same ? s.quantity : null
    if (quantity == null || !Number.isInteger(quantity) || quantity < 1) return fail(T, s.code, `${p.name} 은 개수로 셉니다 — quantity(1 이상의 정수)를 주세요.`)
    if (has(args, "quantity") || !same) input.quantity = quantity
  }
  // 기관
  let org = s.org
  if (has(args, "org")) {
    const o = resolveOrgRef(str(args.org), await port.orgs())
    if ("problem" in o) return fail(T, s.code, o.problem)
    if (o.org.id !== s.org.id) {
      if (s.sampleCode) return fail(T, s.code, `샘플요청 ${s.sampleCode} 에서 나온 출고입니다 — 기관은 update_sample 로 고쳐 주세요.`)
      org = { id: o.org.id, name: o.org.name }
      input.orgId = org.id
    }
  }
  let date = s.date
  if (has(args, "date")) {
    const d = parseDate(args.date, now)
    if ("problem" in d) return fail(T, s.code, d.problem)
    date = d.date
    if (date !== s.date) input.shippedAt = date
  }
  let kind: string = s.kind
  if (has(args, "kind")) {
    kind = str(args.kind).toUpperCase()
    if (!(kind in SHIPMENT_KIND_LABEL)) return fail(T, s.code, "kind 는 SALE · SAMPLE · GIFT 중 하나입니다.")
    if (kind !== s.kind) input.kind = kind
  }
  let status: string = s.status
  if (has(args, "status")) {
    status = str(args.status).toUpperCase()
    if (!(status in SHIPMENT_STATUS_LABEL)) return fail(T, s.code, "status 는 PREPARING · SHIPPING · DELIVERED 중 하나입니다.")
    if (status !== s.status) input.status = status
  }
  let note = s.note
  if (args.note !== undefined && args.note !== null) {
    note = str(args.note).slice(0, 2000) || null
    if (note !== s.note) input.note = note
  }

  const before = shipmentLine(s.date, s.org.name, oldP, { conc: s.concentrationPct, vol: s.volumeMl }, s.quantity, s.kind, s.status, s.note)
  const after = shipmentLine(date, org.name, p, v, quantity, kind, status, note)
  if (before === after) return fail(T, s.code, "바뀌는 것이 없습니다 — 고칠 칸(product_id · concentration · volume_ml · quantity · org · kind · status · date · note)을 주세요.")
  // 재고: 이 출고가 뺀 것을 돌려놓고 새로 뺀다(재고에 반영된 출고만)
  const e = s.ledger && oldP
    ? stockEffects([
      { p: oldP, v: { conc: s.concentrationPct, vol: null }, delta: shippedAmount(oldP, s) },
      { p, v: { conc: v.conc, vol: null }, delta: -(p.gelType ? v.vol ?? 0 : quantity ?? 0) },
    ])
    : { rows: [], warnings: [] }
  // 같은 칸 · 같은 양이면 재고 줄은 「그대로」라 보이지 않게 한다
  const rows = e.rows.filter((r) => r.before !== r.after)
  return {
    title: T, target: `${s.code} · ${s.org.name}`,
    changes: [
      { label: "출고", before: `${s.code} · ${before}`, after },
      ...rows,
      ...(s.ledger ? [] : [{ label: "재고", before: null, after: "바뀌지 않음 — 엑셀에서 넘어온 「미반영」 출고입니다" }]),
    ],
    warning: joinWarn(e.warnings),
    risk: s.ledger
      ? "이 출고에서 나온 재고 장부 줄을 새 값으로 다시 만듭니다 — 재고가 다시 계산됩니다. 활동 기록에 내 이름으로 남습니다."
      : "출고 기록만 바뀌고 재고는 그대로입니다. 활동 기록에 내 이름으로 남습니다.",
    op: { kind: "updateShipment", id: s.id, input },
    done: { entity: "crm.shipment", action: "update", title: `출고 고침 ${s.code} · ${p.gelType ? variantProductLabel(p, v.conc, v.vol) : `${productLabel(p)} ${quantity}개`}` },
  }
}

async function planDeleteShipment(args: Record<string, unknown>, port: CrmPort): Promise<CrmPlan> {
  const T = "CRM 출고 지우기"
  const t = await shipmentTarget(args, port, T)
  if ("plan" in t) return t.plan
  const s = t.v
  const products = await port.products()
  const p = products.find((x) => x.id === s.productId)
  const e = s.ledger && p ? stockEffects([{ p, v: { conc: s.concentrationPct, vol: null }, delta: shippedAmount(p, s) }]) : { rows: [], warnings: [] }
  const line = shipmentLine(s.date, s.org.name, p, { conc: s.concentrationPct, vol: s.volumeMl }, s.quantity, s.kind, s.status, s.note)
  return {
    title: T, target: `${s.code} · ${s.org.name}`,
    changes: [
      { label: "지울 출고", before: `${s.code} · ${line}`, after: "지움" },
      ...e.rows,
      ...(s.ledger ? [] : [{ label: "재고", before: null, after: "바뀌지 않음 — 엑셀에서 넘어온 「미반영」 출고입니다" }]),
      ...(s.sampleCode ? [{ label: "샘플요청", before: null, after: `${s.sampleCode} 는 남고 이 출고와의 연결만 끊깁니다` }] : []),
    ],
    risk: `출고${s.ledger ? "와 그 출고에서 나온 재고 장부 줄을" : "를"} 지웁니다${s.ledger ? " — 재고가 출고 전으로 돌아옵니다" : ""}. 되돌릴 수 없습니다. 활동 기록에 내 이름으로 남습니다.`,
    op: { kind: "deleteShipment", id: s.id },
    done: { entity: "crm.shipment", action: "delete", title: `출고 지움 ${s.code} · ${s.org.name}` },
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
