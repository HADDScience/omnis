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
}

export async function planInvoice(r: ParsedInvoice, orgs?: OrgWithQuotes[]): Promise<InvoicePlan> {
  const list = orgs ?? (await loadOrgsForMatching())
  const purchase = r.direction === "PURCHASE"
  const counterName = (purchase ? r.supplierName : r.buyerName) ?? null
  const counterBizNo = (purchase ? r.supplierBizNo : r.buyerBizNo) ?? null
  const { org, how } = matchOrg(list, counterName, counterBizNo, r.totalKrw, r.issuedOn)
  // 견적은 우리가 파는 쪽에만 있다
  const quote = org && !purchase ? matchQuote(org, r.totalKrw, r.issuedOn) : null
  const elsewhere = quote || purchase ? [] : quotesElsewhere(list, org?.id ?? null, r.totalKrw, r.issuedOn)
  const duplicate = r.approvalNo
    ? await prisma.taxInvoice.findUnique({ where: { approvalNo: r.approvalNo }, select: { id: true } })
    : null
  return {
    counterName,
    counterBizNo,
    org: org ? { id: org.id, code: org.code, name: org.name } : null,
    how,
    fillBizNo: !!org && !org.bizRegNo && !!counterBizNo && !list.some((o) => o.bizRegNo === counterBizNo),
    quote,
    elsewhere,
    duplicateId: duplicate?.id ?? null,
  }
}

const REQUIRED = ["approvalNo", "direction", "issuedOn", "supplierBizNo", "supplierName", "buyerBizNo", "buyerName", "supplyKrw", "taxKrw", "totalKrw"] as const

/** 저장해도 되는지. 빈 칸이 있거나 합계 대조가 틀리면 사람이 고쳐 올려야 한다 */
export function saveBlockers(r: ParsedInvoice, plan: InvoicePlan): string[] {
  const missing = REQUIRED.filter((k) => r[k] === null || r[k] === undefined)
  return [
    ...(missing.length ? [`읽지 못한 칸: ${missing.join(", ")}`] : []),
    ...r.checks.problems,
    ...(plan.duplicateId ? ["이미 올린 세금계산서입니다 (승인번호 같음)"] : []),
  ]
}

export async function saveInvoice(
  r: ParsedInvoice,
  plan: InvoicePlan,
  file: { data: Buffer; mimeType: string; fileName: string },
  userId: string | null
) {
  const blockers = saveBlockers(r, plan)
  if (blockers.length) throw new InvoiceSaveError(blockers.join(" · "))
  const ext = INVOICE_MIME_EXT[file.mimeType]
  if (!ext) throw new InvoiceSaveError("PDF · PNG · JPG 만 올릴 수 있습니다")

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
  const objectKey = `tax-invoices/${r.issuedOn!.slice(0, 4)}/${r.approvalNo}.${ext}`
  await putObject(objectKey, file.data, file.mimeType)

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
      quoteId: plan.quote?.id ?? null,
      objectKey,
      fileName: file.fileName,
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
  if (plan.quote) {
    await prisma.crmQuote.updateMany({ where: { id: plan.quote.id, taxInvoicedAt: null }, data: { taxInvoicedAt: issuedOn } })
  }
  return { invoice, orgId, createdOrg }
}
