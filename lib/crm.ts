import { z } from "zod"
import {
  CrmOrgType,
  CrmQuoteStatus,
  CrmMembershipStatus,
  CrmSampleStatus,
  CrmShipmentKind,
  CrmShipmentStatus,
} from "@/generated/prisma"

/**
 * 견적 금액 계산의 **단일 정본**.
 *
 * 엑셀에서는 이 식이 셀 수식으로 흩어져 있었고, 그래서 13건 중 7건에서 할인이
 * 소계에 반영되지 않은 채로 남았다. 화면·API·이식 스크립트가 전부 이 함수만
 * 쓰게 해서 같은 일이 다시 생기지 않게 한다.
 */
export interface QuoteLine {
  quantity: number
  unitPrice: number
}

export interface QuoteTotals {
  supply: number // 공급가 = Σ 수량 × 단가
  discount: number // 실제로 깎는 금액
  subtotal: number // 소계 = 공급가 − 할인
  vat: number // 부가세
  total: number // 실 합계
}

export function quoteTotals(
  lines: QuoteLine[],
  discount = 0,
  vatRate = 10
): QuoteTotals {
  const supply = lines.reduce((a, l) => a + l.quantity * l.unitPrice, 0)
  // 할인이 공급가보다 클 수는 없다. 엑셀에서는 음수 소계가 그냥 만들어졌다.
  const applied = Math.min(Math.max(discount, 0), supply)
  const subtotal = supply - applied
  const vat = Math.round((subtotal * vatRate) / 100)
  return { supply, discount: applied, subtotal, vat, total: subtotal + vat }
}

export const won = (n: number) => `₩${n.toLocaleString("ko-KR")}`

// ─── 한국어 라벨 ──────────────────────────────────────────

export const ORG_TYPE_LABEL: Record<CrmOrgType, string> = {
  UNIVERSITY: "대학",
  RESEARCH: "연구원",
  COMPANY: "기업",
  HOSPITAL: "병원",
  OTHER: "기타",
}

export const QUOTE_STATUS_LABEL: Record<CrmQuoteStatus, string> = {
  DRAFT: "작성중",
  SENT: "발송",
  DONE: "완료",
  CANCELLED: "취소",
}

export const SAMPLE_STATUS_LABEL: Record<CrmSampleStatus, string> = {
  PENDING: "미발송",
  SENT: "발송완료",
}

export const SHIPMENT_KIND_LABEL: Record<CrmShipmentKind, string> = {
  SALE: "판매",
  SAMPLE: "샘플",
  GIFT: "증정",
}

export const SHIPMENT_STATUS_LABEL: Record<CrmShipmentStatus, string> = {
  PREPARING: "준비중",
  SHIPPING: "배송중",
  DELIVERED: "배송완료",
}

export const MEMBERSHIP_STATUS_LABEL: Record<CrmMembershipStatus, string> = {
  ACTIVE: "활성",
  INACTIVE: "해지",
}

/** 담당자명이 비어 이식된 자리. 화면에서 눈에 띄게 표시해 채우도록 유도한다. */
export const CONTACT_NO_NAME = "(이름 미상)"

// ─── 입력 스키마 (AI ↔ DB Zod SSOT, 규칙 13) ──────────────

export const orgCreateSchema = z.object({
  name: z.string().trim().min(1, "기관명을 입력해 주세요").max(200),
  type: z.enum(CrmOrgType).default(CrmOrgType.OTHER),
  address: z.string().trim().max(500).optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
})

export const contactCreateSchema = z.object({
  orgId: z.string().uuid(),
  name: z.string().trim().min(1, "담당자명을 입력해 주세요").max(100),
  title: z.string().trim().max(50).optional().nullable(),
  phone: z.string().trim().max(50).optional().nullable(),
  email: z.string().trim().max(200).optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
})

export const quoteItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1, "수량은 1 이상이어야 합니다"),
  unitPrice: z.number().int().min(0),
  note: z.string().trim().max(500).optional().nullable(),
})

export const quoteCreateSchema = z.object({
  quotedAt: z.coerce.date(),
  orgId: z.string().uuid(),
  contactId: z.string().uuid().optional().nullable(),
  membershipId: z.string().uuid().optional().nullable(),
  discountAmount: z.number().int().min(0).default(0),
  status: z.enum(CrmQuoteStatus).default(CrmQuoteStatus.DRAFT),
  note: z.string().trim().max(2000).optional().nullable(),
  items: z.array(quoteItemSchema).min(1, "품목을 하나 이상 넣어 주세요"),
})

/**
 * HADD{YYMMDD}-{일련}. 엑셀이 견적과 샘플요청 양쪽에 쓰던 형식을 그대로 잇는다.
 * 사람이 지난 문서와 대조할 때 형식이 바뀌면 곤란하다.
 */
export function nextDatedCode(quotedAt: Date, existingCodes: string[]): string {
  // 날짜는 UTC 자정으로 다룬다 — 지역 시간으로 읽으면 시간대에 따라 하루가 밀린다
  const yy = String(quotedAt.getUTCFullYear()).slice(2)
  const mm = String(quotedAt.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(quotedAt.getUTCDate()).padStart(2, "0")
  const seq = existingCodes.reduce((max, c) => {
    const m = /^HADD\d{6}-(\d+)$/.exec(c)
    return m ? Math.max(max, Number(m[1])) : max
  }, 0)
  return `HADD${yy}${mm}${dd}-${String(seq + 1).padStart(3, "0")}`
}

/** ORG001 · CT001 · PRD001 처럼 접두사 + 3자리 일련번호. */
export function nextCode(prefix: string, existingCodes: string[]): string {
  const re = new RegExp(`^${prefix}(\\d+)$`)
  const seq = existingCodes.reduce((max, c) => {
    const m = re.exec(c)
    return m ? Math.max(max, Number(m[1])) : max
  }, 0)
  return `${prefix}${String(seq + 1).padStart(3, "0")}`
}

/**
 * 현재고. 장부(IN/OUT)를 더해서 구한다 — 어딘가에 적힌 요약 숫자를 믿지 않는다.
 * 엑셀은 요약 칸을 따로 뒀고 출고를 "별도 관리" 해서, 출고 23건이 있는데도
 * 총 출고량이 0 으로 남아 있었다.
 */
export function stockBalance(
  // Prisma 의 Decimal 이 그대로 들어와도 되게 Number() 로 받는다.
  moves: { direction: "IN" | "OUT"; quantity: number | { toString(): string } }[]
): { inQty: number; outQty: number; balance: number } {
  const n = (q: number | { toString(): string }) => Number(q)
  const inQty = moves.filter((m) => m.direction === "IN").reduce((a, m) => a + n(m.quantity), 0)
  const outQty = moves.filter((m) => m.direction === "OUT").reduce((a, m) => a + n(m.quantity), 0)
  // 소수 합산의 부동소수 오차를 장부 정밀도(소수 셋째 자리)에서 자른다.
  const r = (x: number) => Math.round(x * 1000) / 1000
  return { inQty: r(inQty), outQty: r(outQty), balance: r(inQty - outQty) }
}

// ─── 생산 계산 ────────────────────────────────────────────

/**
 * 완제품 한 개에 드는 원료(g).
 *
 * 농도 1wt% 는 1ml 당 0.01g 이다 — 0.4g / 20ml = 2wt% 라는 실제 배합에서 나온 값.
 * 그래서 10ml 짜리 1wt% 제품 한 개에 0.1g 이 들고, 4g 이면 40개가 나온다.
 *
 * 용량이나 농도가 비어 있으면 null 을 준다. 모르는 값을 1 로 가정하면 화면은
 * 그럴듯한 숫자를 보여 주지만 재고가 조용히 틀어진다.
 */
export function gramsPerUnit(
  volumeMl: number | null | undefined,
  concentrationPct: number | null | undefined
): number | null {
  if (volumeMl == null || concentrationPct == null) return null
  if (volumeMl <= 0 || concentrationPct <= 0) return null
  return (volumeMl * concentrationPct) / 100
}

/** 개수 → 필요한 원료(g). 소수 셋째 자리에서 반올림한다(장부 정밀도와 맞춘다). */
export function gramsForQuantity(
  quantity: number,
  volumeMl: number | null | undefined,
  concentrationPct: number | null | undefined
): number | null {
  const per = gramsPerUnit(volumeMl, concentrationPct)
  if (per == null) return null
  return Math.round(quantity * per * 1000) / 1000
}

/** 원료(g) → 만들 수 있는 개수. 남는 그램은 버리지 않고 그대로 둔다. */
export function quantityFromGrams(
  grams: number,
  volumeMl: number | null | undefined,
  concentrationPct: number | null | undefined
): number | null {
  const per = gramsPerUnit(volumeMl, concentrationPct)
  if (per == null || per <= 0) return null
  return Math.floor(grams / per)
}

/** 재고 단위 표기. 원료는 g, 완제품은 개. */
export function formatStock(qty: number, unit: "PIECE" | "GRAM"): string {
  if (unit === "GRAM") {
    // 106.5g 처럼 소수가 있으면 보여 주고, 없으면 정수로
    return `${Number(qty.toFixed(3))}g`
  }
  return `${qty}개`
}
