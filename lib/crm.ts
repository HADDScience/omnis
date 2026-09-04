import { z } from "zod"
import { CrmOrgType, CrmQuoteStatus, CrmMembershipStatus } from "@/generated/prisma"

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
 * 견적번호. 엑셀이 쓰던 HADD{YYMMDD}-{일련} 형식을 그대로 잇는다.
 * 사람이 지난 문서와 대조할 때 형식이 바뀌면 곤란하다.
 */
export function nextQuoteCode(quotedAt: Date, existingCodes: string[]): string {
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
