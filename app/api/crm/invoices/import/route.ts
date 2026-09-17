import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { writeActivity } from "@/lib/api"
import { MAX_UPLOAD_BYTES } from "@/lib/storage"
import { quoteTotals } from "@/lib/crm"
import { readInvoice, type ParsedInvoice } from "@/lib/tax-invoice"
import { looksLikeHometaxExcel, readHometaxExcel } from "@/lib/hometax-excel"
import {
  INVOICE_MIME_EXT,
  InvoiceSaveError,
  loadOrgsForMatching,
  planInvoice,
  saveBlockers,
  saveInvoice,
  type InvoiceDecisions,
} from "@/lib/tax-invoice-save"
import { demoStorageBlocked } from "@/lib/demo"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * 세금계산서 가져오기 — 한 입구로 엑셀도 PDF 도 받는다 (2026-09-17).
 *
 * 화면은 파일을 한 장씩 보낸다(Vercel 요청 본문 4.5MB). 두 번 부른다.
 * - mode=preview — 읽고, 기관 · 견적을 잇는 계획과 **사람에게 물어야 할 것**을 돌려준다. 저장 안 함
 * - mode=confirm — 같은 파일을 서버에서 다시 읽어, 사람이 답한 대로 저장한다
 *
 * 브라우저가 보낸 판독값은 믿지 않는다. 답(decisions)만 받는다.
 */
type Decisions = Record<string, InvoiceDecisions & { skip?: boolean; acceptVision?: boolean }>

async function readFile(file: File, userId: string): Promise<{ invoices: ParsedInvoice[]; source: "excel" | "pdf"; mimeType: string; buffer: Buffer }> {
  const buffer = Buffer.from(await file.arrayBuffer())
  if (looksLikeHometaxExcel(file.name)) {
    const r = readHometaxExcel(new Uint8Array(buffer))
    return { invoices: r.invoices, source: "excel", mimeType: file.type, buffer }
  }
  const mimeType = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "")
  if (!INVOICE_MIME_EXT[mimeType]) throw new UserError("홈택스 목록 엑셀(.xls · .xlsx) 이나 세금계산서 PDF · 사진만 올릴 수 있습니다", 415)
  const invoice = await readInvoice(new Uint8Array(buffer), mimeType, { userId, allowVision: true })
  return { invoices: [invoice], source: "pdf", mimeType, buffer }
}

class UserError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message)
  }
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  const blocked = demoStorageBlocked()
  if (blocked) return blocked
  const userId = session.user.id

  const form = await req.formData().catch(() => null)
  const file = form?.get("file")
  const mode = form?.get("mode")
  if (!(file instanceof File)) return NextResponse.json({ error: "파일이 필요합니다" }, { status: 400 })
  if (mode !== "preview" && mode !== "confirm") return NextResponse.json({ error: "mode 는 preview 또는 confirm" }, { status: 400 })
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: `파일이 너무 큽니다. ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB 이하만 올릴 수 있습니다` }, { status: 413 })
  }

  let read
  try {
    read = await readFile(file, userId)
  } catch (err) {
    if (err instanceof UserError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error("[crm/invoices/import] 판독 실패", { name: file.name, err })
    return NextResponse.json({ error: "읽지 못했습니다. 홈택스에서 받은 엑셀이나 PDF 인지 확인해 주세요" }, { status: 422 })
  }

  const orgs = await loadOrgsForMatching()
  const hasFile = read.source === "pdf"

  if (mode === "preview") {
    const rows = []
    for (const invoice of read.invoices) {
      const plan = await planInvoice(invoice, orgs, { hasFile })
      const org = plan.org ? orgs.find((o) => o.id === plan.org!.id) : null
      // 「어느 견적인가요?」 에 내밀 후보 — 이어진 기관의 견적, 합계가 맞는 것부터
      const candidates =
        invoice.direction === "SALE" && org
          ? org.quotes
              .map((q) => {
                const t = quoteTotals(q.items.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice })), q.discountAmount, q.vatRate)
                return { id: q.id, code: q.code, quotedAt: q.quotedAt.toISOString().slice(0, 10), total: t.total, invoiced: !!q.taxInvoicedAt, sameTotal: t.total === invoice.totalKrw }
              })
              .sort((a, b) => Number(b.sameTotal) - Number(a.sameTotal) || b.quotedAt.localeCompare(a.quotedAt))
              .slice(0, 6)
          : []
      rows.push({ invoice, plan, blockers: saveBlockers(invoice, plan), candidates })
    }
    return NextResponse.json({ source: read.source, fileName: file.name, rows })
  }

  let decisions: Decisions = {}
  try {
    decisions = JSON.parse(String(form?.get("decisions") ?? "{}"))
  } catch {
    return NextResponse.json({ error: "답을 읽지 못했습니다" }, { status: 400 })
  }

  const results: { approvalNo: string | null; status: "saved" | "attached" | "skipped" | "failed"; message?: string }[] = []
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
      const saved = await saveInvoice(
        invoice,
        plan,
        hasFile ? { data: read.buffer, mimeType: read.mimeType, fileName: file.name } : null,
        userId,
        d
      )
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
    title: `세금계산서 가져오기: ${file.name} · 저장 ${count("saved")} · PDF 붙임 ${count("attached")} · 건너뜀 ${count("skipped")} · 실패 ${count("failed")}`,
    metadata: { source: read.source, results },
  })
  return NextResponse.json({ results })
}
