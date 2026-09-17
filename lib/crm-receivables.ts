// 받을 돈 · 줄 돈 — 세금계산서와 입금 기록으로 계산한다 (2026-09-17).
//
// 「입금 완료」 칸을 저장하지 않는다. 합계와 입금을 매번 더한다 — 요약 칸은 언젠가 장부와
// 어긋난다(tech/crm.md 「현재고는 어디에도 저장하지 않는다」 와 같은 이유).
//
// **수정세금계산서는 한 줄로 묶는다.** 울산대 2026-05-18 은 당초(+1,650,000) → 수정 취소(−) →
// 수정 재발행(+) 세 장이다. 장마다 세면 받을 돈이 3,300,000 으로 두 번 잡힌다. 당초 승인번호로
// 묶어 합계를 더하면 1,650,000 이 된다. 입금은 묶음 안 어느 장에 적혀도 같이 센다.
import { prisma } from "@/lib/db"
import type { TaxInvoiceDirection } from "@/generated/prisma/client"

/** 시작 전 정리로 적은 입금의 메모 — 진짜 입금 기록과 가릴 수 있게 고정 문구로 둔다 */
export const SETTLE_NOTE = "시작 전 정리 — 실제 입금일 모름"

/** 발행 뒤 이만큼 지나도 다 안 들어오면 「늦은」 것으로 본다 */
export const OVERDUE_DAYS = 30

const DAY = 86_400_000

export interface ReceivableChain {
  /** 입금을 적을 장 — 묶음에서 가장 최근의 + 장 */
  invoiceId: string
  approvalNo: string
  direction: TaxInvoiceDirection
  issuedOn: string
  counterName: string
  orgId: string | null
  quote: { id: string; code: string } | null
  total: number
  paid: number
  remaining: number
  days: number
  overdue: boolean
  /** 수정세금계산서로 묶인 장 수 (1 이면 일반) */
  sheets: number
}

export async function receivableChains(direction: TaxInvoiceDirection = "SALE", now = new Date()): Promise<ReceivableChain[]> {
  const invoices = await prisma.taxInvoice.findMany({
    where: { direction },
    orderBy: { issuedOn: "asc" },
    select: {
      id: true, approvalNo: true, originalApprovalNo: true, issuedOn: true, totalKrw: true,
      buyerName: true, supplierName: true, orgId: true,
      quote: { select: { id: true, code: true } },
      payments: { select: { amountKrw: true } },
    },
  })

  const chains = new Map<string, typeof invoices>()
  for (const inv of invoices) {
    const root = inv.originalApprovalNo ?? inv.approvalNo
    chains.set(root, [...(chains.get(root) ?? []), inv])
  }

  const out: ReceivableChain[] = []
  for (const sheets of chains.values()) {
    const total = sheets.reduce((a, s) => a + Number(s.totalKrw), 0)
    if (total <= 0) continue // 전부 취소된 묶음
    const paid = sheets.reduce((a, s) => a + s.payments.reduce((b, p) => b + Number(p.amountKrw), 0), 0)
    const target = [...sheets].reverse().find((s) => Number(s.totalKrw) > 0) ?? sheets[sheets.length - 1]
    const days = Math.floor((now.getTime() - target.issuedOn.getTime()) / DAY)
    const remaining = total - paid
    out.push({
      invoiceId: target.id,
      approvalNo: target.approvalNo,
      direction,
      issuedOn: target.issuedOn.toISOString().slice(0, 10),
      counterName: direction === "SALE" ? target.buyerName : target.supplierName,
      orgId: target.orgId,
      quote: sheets.find((s) => s.quote)?.quote ?? null,
      total,
      paid,
      remaining,
      days,
      overdue: remaining > 0 && days > OVERDUE_DAYS,
      sheets: sheets.length,
    })
  }
  return out
}

/** 아직 덜 들어온 것만, 오래된 것부터 */
export async function outstanding(direction: TaxInvoiceDirection = "SALE", now = new Date()) {
  return (await receivableChains(direction, now)).filter((c) => c.remaining > 0).sort((a, b) => b.days - a.days)
}
