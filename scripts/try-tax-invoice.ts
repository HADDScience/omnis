// 세금계산서 판독 시험 — 폴더의 PDF 를 전부 읽고 검산 결과를 찍는다.
//
//   npx tsx scripts/try-tax-invoice.ts [폴더] [--vision]
//
// --vision 이 없으면 글자 판독만 (AI 호출 0). 있으면 글자로 못 읽은 것만 Gemini 로 다시 읽는다.
import "dotenv/config"
import { readFileSync, readdirSync } from "fs"
import { join } from "path"
import { readInvoiceText, readInvoiceVision, type ParsedInvoice } from "@/lib/tax-invoice"

const dir = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? `${process.env.HOME}/work/omnis-import/notion/invoices`
const vision = process.argv.includes("--vision")

async function main() {
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf")).sort()
  const sums: Record<string, { sale: number; product: number; service: number; n: number }> = {}
  let ok = 0
  for (const f of files) {
    const data = new Uint8Array(readFileSync(join(dir, f)))
    const t0 = performance.now()
    let r: ParsedInvoice | null = await readInvoiceText(data)
    let how = "글자"
    if ((!r || r.checks.problems.length) && vision) { r = await readInvoiceVision(data, "application/pdf"); how = "비전" }
    const ms = Math.round(performance.now() - t0)
    if (!r) { console.log(`✗ ${f} — 글자 없음 (이미지 PDF). --vision 으로 다시`); continue }
    const pass = r.checks.problems.length === 0
    if (pass) ok++
    console.log(`${pass ? "✓" : "✗"} ${r.issuedOn} ${r.direction ?? "?"} [${how} ${ms}ms] ${r.supplierName} → ${r.buyerName}(${r.buyerBizNo}) · 대표 ${r.buyerCeo} · 공급가 ${r.supplyKrw?.toLocaleString()} 세액 ${r.taxKrw?.toLocaleString()} 합계 ${r.totalKrw?.toLocaleString()} · ${r.kind}${r.originalApprovalNo ? ` 당초 ${r.originalApprovalNo}` : ""} · ${r.approvalNo}`)
    for (const it of r.items) console.log(`     ${it.lineNo}. [${it.category}] ${it.name} | ${it.spec ?? "-"} | ${it.quantity} × ${it.unitKrw?.toLocaleString()} = ${it.supplyKrw.toLocaleString()} (+${it.taxKrw.toLocaleString()})`)
    if (!pass) console.log(`     문제: ${r.checks.problems.join(" · ")}`)
    if (r.direction === "SALE" && r.issuedOn) {
      const y = r.issuedOn.slice(0, 4); sums[y] ??= { sale: 0, product: 0, service: 0, n: 0 }
      sums[y].sale += r.supplyKrw ?? 0; sums[y].n++
      for (const it of r.items) sums[y][it.category === "용역" ? "service" : "product"] += it.supplyKrw
    }
  }
  console.log(`\n검산 통과 ${ok}/${files.length}`)
  for (const [y, s] of Object.entries(sums)) console.log(`${y} 매출 ${s.n}장 · 공급가 ${s.sale.toLocaleString()} (제품 ${s.product.toLocaleString()} · 용역 ${s.service.toLocaleString()})`)
}
main().catch((e) => { console.error(e); process.exitCode = 1 })
