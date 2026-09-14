import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { writeActivity } from "@/lib/api"
import { MAX_UPLOAD_BYTES } from "@/lib/storage"
import { readInvoice } from "@/lib/tax-invoice"
import { INVOICE_MIME_EXT, InvoiceSaveError, planInvoice, saveBlockers, saveInvoice } from "@/lib/tax-invoice-save"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * 발행된 세금계산서를 올린다. 두 번 부른다.
 *
 * - mode=preview — 읽고(글자 → 안 되면 AI 판독) 기관 · 견적 잇기 계획을 돌려준다. 아무것도 저장하지 않는다.
 * - mode=confirm — 같은 파일을 다시 읽어 저장한다. 미리보기 값과 승인번호 · 합계가 다르면 저장하지 않는다.
 *   AI 가 읽은 것은 사람이 원본과 대조했다는 표시(acceptVision=1)가 있어야 저장한다.
 *
 * 브라우저가 보낸 판독값을 믿지 않고 서버에서 다시 읽는다. 글자 PDF 는 공짜고,
 * AI 판독은 한 번 더 부른다(장당 약 4원).
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  const userId = session.user.id

  const form = await req.formData().catch(() => null)
  const file = form?.get("file")
  const mode = form?.get("mode")
  if (!(file instanceof File)) return NextResponse.json({ error: "파일이 필요합니다" }, { status: 400 })
  if (mode !== "preview" && mode !== "confirm") return NextResponse.json({ error: "mode 는 preview 또는 confirm" }, { status: 400 })
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: `파일이 너무 큽니다. ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB 이하만 올릴 수 있습니다` }, { status: 413 })
  }
  const mimeType = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "")
  if (!INVOICE_MIME_EXT[mimeType]) return NextResponse.json({ error: "PDF · PNG · JPG 만 올릴 수 있습니다" }, { status: 415 })

  const buffer = Buffer.from(await file.arrayBuffer())
  let invoice
  try {
    invoice = await readInvoice(new Uint8Array(buffer), mimeType, { userId, allowVision: true })
  } catch (err) {
    console.error("[crm/invoices] 판독 실패", { name: file.name, err })
    return NextResponse.json({ error: "세금계산서를 읽지 못했습니다. 홈택스에서 받은 PDF 인지 확인해 주세요" }, { status: 422 })
  }
  const plan = await planInvoice(invoice)
  const blockers = saveBlockers(invoice, plan)

  if (mode === "preview") return NextResponse.json({ invoice, plan, blockers })

  if (form?.get("expectApprovalNo") !== invoice.approvalNo || form?.get("expectTotal") !== String(invoice.totalKrw)) {
    return NextResponse.json({ error: "다시 읽은 값이 미리보기와 다릅니다. 파일을 다시 올려 주세요", invoice, plan, blockers }, { status: 409 })
  }
  if (invoice.readBy === "vision" && form?.get("acceptVision") !== "1") {
    return NextResponse.json({ error: "AI 가 읽은 세금계산서는 원본과 대조했다고 표시해야 저장합니다" }, { status: 409 })
  }

  try {
    const saved = await saveInvoice(invoice, plan, { data: buffer, mimeType, fileName: file.name }, userId)
    await writeActivity({
      userId,
      action: "crm.invoice.uploaded",
      entity: "TAX_INVOICE",
      entityId: saved.invoice.id,
      title: `세금계산서 업로드: ${plan.counterName} ${invoice.issuedOn} ${Number(invoice.supplyKrw).toLocaleString("ko-KR")}원`,
      metadata: { approvalNo: invoice.approvalNo, orgId: saved.orgId, quoteId: plan.quote?.id ?? null, readBy: invoice.readBy, createdOrg: saved.createdOrg?.code ?? null },
    })
    return NextResponse.json({ id: saved.invoice.id, createdOrg: saved.createdOrg, quote: plan.quote }, { status: 201 })
  } catch (err) {
    if (err instanceof InvoiceSaveError) return NextResponse.json({ error: err.message }, { status: 422 })
    console.error("[crm/invoices] 저장 실패", { approvalNo: invoice.approvalNo, err })
    return NextResponse.json({ error: "저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요" }, { status: 500 })
  }
}
