// 세금계산서 가져오기 — 한 입구로 홈택스 엑셀도 PDF · 사진도 받는다(2026-09-17).
// 화면(app/api/crm/invoices/import)과 도구(import_tax_invoice, lib/tools/plan-crm.ts)가 같이 부른다.
// 판독값은 언제나 서버가 파일을 다시 읽어 만든다 — 사람(또는 AI)에게서는 답(decisions)만 받는다.
import { writeActivity } from "@/lib/api"
import { readInvoice, type ParsedInvoice } from "@/lib/tax-invoice"
import { looksLikeHometaxExcel, readHometaxExcel } from "@/lib/hometax-excel"
import { INVOICE_MIME_EXT, InvoiceSaveError, loadOrgsForMatching, planInvoice, saveInvoice, type InvoiceDecisions } from "@/lib/tax-invoice-save"

export type ImportDecisions = Record<string, InvoiceDecisions & { skip?: boolean; acceptVision?: boolean }>

export interface ReadSource {
  invoices: ParsedInvoice[]
  source: "excel" | "pdf"
  mimeType: string
  buffer: Buffer
}

/** 사람에게 그대로 보여 줄 수 있는 판독 거절(형식 · 크기) */
export class ImportUserError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message)
  }
}

/** 파일 → 세금계산서들. 엑셀은 여러 장, PDF · 사진은 한 장(글자가 없으면 AI 판독) */
export async function readInvoiceSource(buffer: Buffer, fileName: string, mimeType: string, userId: string): Promise<ReadSource> {
  if (looksLikeHometaxExcel(fileName)) {
    const r = readHometaxExcel(new Uint8Array(buffer))
    return { invoices: r.invoices, source: "excel", mimeType, buffer }
  }
  const mime = mimeType || (fileName.toLowerCase().endsWith(".pdf") ? "application/pdf" : "")
  if (!INVOICE_MIME_EXT[mime]) throw new ImportUserError("홈택스 목록 엑셀(.xls · .xlsx) 이나 세금계산서 PDF · 사진만 올릴 수 있습니다", 415)
  const invoice = await readInvoice(new Uint8Array(buffer), mime, { userId, allowVision: true })
  return { invoices: [invoice], source: "pdf", mimeType: mime, buffer }
}

export type ImportResult = { approvalNo: string | null; status: "saved" | "attached" | "skipped" | "failed"; message?: string }

/** 읽은 것을 답대로 저장하고 활동 기록을 남긴다 */
export async function importInvoices(read: ReadSource, fileName: string, decisions: ImportDecisions, userId: string): Promise<ImportResult[]> {
  const orgs = await loadOrgsForMatching()
  const hasFile = read.source === "pdf"
  const results: ImportResult[] = []
  for (const invoice of read.invoices) {
    const d = (invoice.approvalNo && decisions[invoice.approvalNo]) || {}
    if (d.skip) {
      results.push({ approvalNo: invoice.approvalNo, status: "skipped" })
      continue
    }
    if (invoice.readBy === "vision" && !d.acceptVision) {
      results.push({ approvalNo: invoice.approvalNo, status: "failed", message: "AI 가 읽은 것은 원본과 대조했다고 표시해야 저장합니다" })
      continue
    }
    try {
      const plan = await planInvoice(invoice, orgs, { hasFile })
      const saved = await saveInvoice(invoice, plan, hasFile ? { data: read.buffer, mimeType: read.mimeType, fileName } : null, userId, d)
      results.push({ approvalNo: invoice.approvalNo, status: saved.attached ? "attached" : "saved" })
      if (saved.createdOrg) orgs.push({ ...saved.createdOrg, bizRegNo: plan.counterBizNo, quotes: [] })
    } catch (err) {
      if (err instanceof InvoiceSaveError) {
        results.push({ approvalNo: invoice.approvalNo, status: "failed", message: err.message })
        continue
      }
      console.error("[crm/invoices/import] 저장 실패", { approvalNo: invoice.approvalNo, err })
      results.push({ approvalNo: invoice.approvalNo, status: "failed", message: "저장하지 못했습니다" })
    }
  }
  const count = (s: string) => results.filter((r) => r.status === s).length
  await writeActivity({
    userId,
    action: "crm.invoice.imported",
    entity: "TAX_INVOICE",
    entityId: null,
    title: `세금계산서 가져오기: ${fileName} · 저장 ${count("saved")} · PDF 붙임 ${count("attached")} · 건너뜀 ${count("skipped")} · 실패 ${count("failed")}`,
    metadata: { source: read.source, results },
  })
  return results
}
