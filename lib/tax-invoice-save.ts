// 세금계산서 저장 — CRM 업로드 화면과 이식 스크립트가 같은 길로 저장한다.
// 순서: 읽기(lib/tax-invoice) → 잇기 계획(planInvoice, 저장 안 함) → 사람 확인 → saveInvoice.
// 설계: mydocs/plans/2026-09-14-company-context.md 「세금계산서」
import type { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/db"
import { putObject } from "@/lib/storage"
import { nextCode } from "@/lib/crm"
import { createWithUniqueCode } from "@/lib/crm-server"
import { matchOrg, matchQuote, quotesElsewhere, type OrgMatchHow, type OrgWithQuotes } from "@/lib/crm-invoice-match"
import type { ParsedInvoice } from "@/lib/tax-invoice"

export const INVOICE_MIME_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
}

export class InvoiceSaveError extends Error {}

export function loadOrgsForMatching(): Promise<OrgWithQuotes[]> {
  return prisma.crmOrg.findMany({
    select: {
      id: true,
      code: true,
      name: true,
      bizRegNo: true,
      quotes: { select: { id: true, code: true, quotedAt: true, discountAmount: true, vatRate: true, taxInvoicedAt: true, items: true } },
    },
  })
}

export interface InvoicePlan {
  /** 우리 쪽이 아닌 상대 — 매출이면 공급받는자, 매입이면 공급자 */
  counterName: string | null
  counterBizNo: string | null
  org: { id: string; code: string; name: string } | null
  how: OrgMatchHow | null
  /** 이어진 기관에 사업자번호가 비어 있어 이번에 채운다 */
  fillBizNo: boolean
  quote: { id: string; code: string } | null
  /** 합계 · 날짜가 맞는 견적이 다른 기관에 있다 — 잇지 않고 보여만 준다 */
  elsewhere: { orgName: string; quoteCode: string }[]
  duplicateId: string | null
  /** 같은 승인번호가 이미 있는데 PDF 가 없다 — 이번 파일을 그 기록에 붙인다(엑셀로 먼저 넣은 경우) */
  attachToId: string | null
  /**
   * 승인번호는 다른데 **같은 날 · 같은 거래처 · 같은 합계**가 이미 있다.
   * 같은 날 두 장을 발행했을 수도, 취소 뒤 다시 발행했을 수도 있다 — 기계가 가를 수 없어 사람에게 묻는다
   * (2025-09-23 가천대 90만원 · 운영 실측 2026-09-17).
   */
  twin: { id: string; approvalNo: string } | null
}

/** 사람이 정한 것 — 화면이 물은 질문의 답 */
export interface InvoiceDecisions {
  /** 이어 붙일 견적. undefined 면 자동 추정, null 이면 「견적 없음」 */
  quoteId?: string | null
  /** 같은 날 · 같은 거래처 · 같은 합계가 있어도 **다른 건**이라고 확인했다 */
  twinIsDifferent?: boolean
}

export async function planInvoice(r: ParsedInvoice, orgs?: OrgWithQuotes[], opts: { hasFile?: boolean } = {}): Promise<InvoicePlan> {
  const list = orgs ?? (await loadOrgsForMatching())
  const purchase = r.direction === "PURCHASE"
  const counterName = (purchase ? r.supplierName : r.buyerName) ?? null
  const counterBizNo = (purchase ? r.supplierBizNo : r.buyerBizNo) ?? null
  const { org, how } = matchOrg(list, counterName, counterBizNo, r.totalKrw, r.issuedOn)
  // 견적은 우리가 파는 쪽에만 있다
  const quote = org && !purchase ? matchQuote(org, r.totalKrw, r.issuedOn) : null
  const elsewhere = quote || purchase ? [] : quotesElsewhere(list, org?.id ?? null, r.totalKrw, r.issuedOn)
  const duplicate = r.approvalNo
    ? await prisma.taxInvoice.findUnique({ where: { approvalNo: r.approvalNo }, select: { id: true, objectKey: true } })
    : null
  const attachToId = duplicate && !duplicate.objectKey && opts.hasFile ? duplicate.id : null
  const twin =
    !duplicate && r.issuedOn && counterBizNo && r.totalKrw !== null && r.direction
      ? await prisma.taxInvoice.findFirst({
          where: {
            direction: r.direction,
            issuedOn: new Date(`${r.issuedOn}T00:00:00Z`),
            totalKrw: BigInt(r.totalKrw),
            OR: [{ buyerBizNo: counterBizNo }, { supplierBizNo: counterBizNo }],
          },
          select: { id: true, approvalNo: true },
        })
      : null
  return {
    counterName,
    counterBizNo,
    org: org ? { id: org.id, code: org.code, name: org.name } : null,
    how,
    fillBizNo: !!org && !org.bizRegNo && !!counterBizNo && !list.some((o) => o.bizRegNo === counterBizNo),
    quote,
    elsewhere,
    duplicateId: duplicate && !attachToId ? duplicate.id : null,
    attachToId,
    twin,
  }
}

const REQUIRED = ["approvalNo", "direction", "issuedOn", "supplierBizNo", "supplierName", "buyerBizNo", "buyerName", "supplyKrw", "taxKrw", "totalKrw"] as const

/** 저장해도 되는지. 빈 칸이 있거나 합계 대조가 틀리면 사람이 고쳐 올려야 한다 */
export function saveBlockers(r: ParsedInvoice, plan: InvoicePlan, decisions: InvoiceDecisions = {}): string[] {
  const missing = REQUIRED.filter((k) => r[k] === null || r[k] === undefined)
  return [
    ...(missing.length ? [`읽지 못한 칸: ${missing.join(", ")}`] : []),
    ...r.checks.problems,
    ...(plan.duplicateId ? ["이미 올린 세금계산서입니다 (승인번호 같음)"] : []),
    ...(plan.twin && !decisions.twinIsDifferent
      ? [`같은 날 · 같은 거래처 · 같은 합계가 이미 있습니다 (승인번호 ${plan.twin.approvalNo}) — 다른 건인지 확인해 주세요`]
      : []),
  ]
}

export async function saveInvoice(
  r: ParsedInvoice,
  plan: InvoicePlan,
  /** 엑셀로 들어온 줄은 파일이 없다 */
  file: { data: Buffer; mimeType: string; fileName: string } | null,
  userId: string | null,
  decisions: InvoiceDecisions = {}
) {
  const blockers = saveBlockers(r, plan, decisions)
  if (blockers.length) throw new InvoiceSaveError(blockers.join(" · "))
  const ext = file ? INVOICE_MIME_EXT[file.mimeType] : null
  if (file && !ext) throw new InvoiceSaveError("PDF · PNG · JPG 만 올릴 수 있습니다")

  // 엑셀로 먼저 들어온 기록에 PDF 만 붙인다 — 숫자는 엑셀(홈택스)이 정본이라 건드리지 않는다
  if (plan.attachToId && file && ext) {
    const objectKey = `tax-invoices/${r.issuedOn!.slice(0, 4)}/${r.approvalNo}.${ext}`
    await putObject(objectKey, file.data, file.mimeType)
    const invoice = await prisma.taxInvoice.update({ where: { id: plan.attachToId }, data: { objectKey, fileName: file.fileName } })
    return { invoice, orgId: invoice.orgId, createdOrg: null, attached: true }
  }

  const counterName = plan.counterName!
  const counterBizNo = plan.counterBizNo!
  let orgId = plan.org?.id ?? null
  let createdOrg: { id: string; code: string; name: string } | null = null
  if (!orgId) {
    // 계획 뒤에 같은 기관이 생겼을 수 있다(여러 장을 이어서 올릴 때)
    const found = await prisma.crmOrg.findFirst({
      where: { OR: [{ bizRegNo: counterBizNo }, { name: counterName }] },
      select: { id: true },
    })
    if (found) orgId = found.id
    else {
      const o = await createWithUniqueCode(async () => {
        const codes = (await prisma.crmOrg.findMany({ select: { code: true } })).map((x) => x.code)
        return prisma.crmOrg.create({
          data: { code: nextCode("ORG", codes), name: counterName, type: "COMPANY", bizRegNo: counterBizNo, note: "세금계산서로 생성" },
        })
      })
      orgId = o.id
      createdOrg = { id: o.id, code: o.code, name: o.name }
    }
  } else if (plan.fillBizNo) {
    await prisma.crmOrg.updateMany({ where: { id: orgId, bizRegNo: null }, data: { bizRegNo: counterBizNo } })
  }

  // NAS 에 먼저 올리고 DB 에 적는다. 키가 승인번호라 다시 올려도 같은 자리를 덮을 뿐이다
  const issuedOn = new Date(`${r.issuedOn}T00:00:00Z`)
  let objectKey: string | null = null
  if (file && ext) {
    objectKey = `tax-invoices/${r.issuedOn!.slice(0, 4)}/${r.approvalNo}.${ext}`
    await putObject(objectKey, file.data, file.mimeType)
  }
  // 사람이 고른 견적이 있으면 그것 — 「견적 없음」(null)도 사람의 답이다
  const quoteId = decisions.quoteId !== undefined ? decisions.quoteId : (plan.quote?.id ?? null)

  const invoice = await prisma.taxInvoice.create({
    data: {
      approvalNo: r.approvalNo!,
      direction: r.direction!,
      kind: r.kind,
      originalApprovalNo: r.originalApprovalNo,
      issuedOn,
      supplierBizNo: r.supplierBizNo!,
      supplierName: r.supplierName!,
      buyerBizNo: r.buyerBizNo!,
      buyerName: r.buyerName!,
      supplyKrw: BigInt(r.supplyKrw!),
      taxKrw: BigInt(r.taxKrw!),
      totalKrw: BigInt(r.totalKrw!),
      orgId,
      quoteId,
      objectKey,
      fileName: file?.fileName ?? null,
      readBy: r.readBy,
      checks: r.checks as unknown as Prisma.InputJsonValue,
      uploadedById: userId,
      items: {
        create: r.items.map((i) => ({
          lineNo: i.lineNo,
          name: i.name,
          spec: i.spec,
          quantity: i.quantity,
          unitKrw: i.unitKrw === null ? null : BigInt(i.unitKrw),
          supplyKrw: BigInt(i.supplyKrw),
          taxKrw: BigInt(i.taxKrw),
          category: i.category,
        })),
      },
    },
  })
  if (quoteId) {
    await prisma.crmQuote.updateMany({ where: { id: quoteId, taxInvoicedAt: null }, data: { taxInvoicedAt: issuedOn } })
  }
  return { invoice, orgId, createdOrg, attached: false }
}
