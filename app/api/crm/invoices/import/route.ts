import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { MAX_UPLOAD_BYTES } from "@/lib/storage"
import { quoteTotals } from "@/lib/crm"
import { loadOrgsForMatching, planInvoice, saveBlockers } from "@/lib/tax-invoice-save"
import { ImportUserError, importInvoices, readInvoiceSource, type ImportDecisions } from "@/lib/tax-invoice-import"
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
    read = await readInvoiceSource(Buffer.from(await file.arrayBuffer()), file.name, file.type, userId)
  } catch (err) {
    if (err instanceof ImportUserError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error("[crm/invoices/import] 판독 실패", { name: file.name, err })
    return NextResponse.json({ error: "읽지 못했습니다. 홈택스에서 받은 엑셀이나 PDF 인지 확인해 주세요" }, { status: 422 })
  }

  const orgs = await loadOrgsForMatching()
  const hasFile = read.source === "pdf"

  if (mode === "preview") {
    const rows = []
    for (const invoice of read.invoices) {
      const plan = await planInvoice(invoice, orgs, { hasFile })
      // 「어느 견적인가요?」 후보 — **합계가 같은 견적만.** 금액이 다른 견적을 내밀면 답할 이유 없는 질문이 된다
      // (국일그래핀 1억 용역에 346만 · 99만 견적을 내밀었다). 다른 기관 견적도 넣는다 — 대학은 견적은 학과로,
      // 세금계산서는 산학협력단으로 나간다(가천대 의과대학 견적 ↔ 가천대학교 산학협력단 세금계산서).
      const candidates =
        invoice.direction === "SALE" && invoice.totalKrw !== null
          ? orgs
              .flatMap((o) =>
                o.quotes.map((q) => {
                  const t = quoteTotals(q.items.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice })), q.discountAmount, q.vatRate)
                  return { id: q.id, code: q.code, orgName: o.name, sameOrg: o.id === plan.org?.id, quotedAt: q.quotedAt.toISOString().slice(0, 10), total: t.total, invoiced: !!q.taxInvoicedAt, sameTotal: t.total === invoice.totalKrw }
                })
              )
              .filter((c) => c.sameTotal)
              .sort((a, b) => Number(b.sameOrg) - Number(a.sameOrg) || Number(a.invoiced) - Number(b.invoiced) || b.quotedAt.localeCompare(a.quotedAt))
              .slice(0, 4)
          : []
      rows.push({ invoice, plan, blockers: saveBlockers(invoice, plan), candidates })
    }
    return NextResponse.json({ source: read.source, fileName: file.name, rows })
  }

  let decisions: ImportDecisions = {}
  try {
    decisions = JSON.parse(String(form?.get("decisions") ?? "{}"))
  } catch {
    return NextResponse.json({ error: "답을 읽지 못했습니다" }, { status: 400 })
  }

  // 저장 · 활동 기록은 lib/tax-invoice-import.ts importInvoices(도구 import_tax_invoice 와 같다)
  const results = await importInvoices(read, file.name, decisions, userId)
  return NextResponse.json({ results })
}
