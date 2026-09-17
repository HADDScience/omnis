// 홈택스 「매출 · 매입 전자(수정)세금계산서 목록조회」 엑셀을 세금계산서로 읽는다 (2026-09-17).
//
// 재무 담당이 이미 내려받는 파일이다. PDF 양식은 발행처마다 달라 좌표 판독이 흔들리지만
// (NAS 매입 151장 중 42장을 못 읽었다), 이 엑셀은 승인번호 · 사업자번호 · 금액이 칸으로 온다.
//
// 목록조회 엑셀의 두 가지 성질:
//   1. 세금계산서 한 장에 **첫 품목 한 줄만** 나온다. 넥셀 2026-05-26 은 공급가 2,400,000 인데
//      품목 줄은 900,000 뿐이다. → 모자라는 만큼 「목록에 없는 품목」 줄로 채워 합계를 맞춘다.
//   2. 수정세금계산서는 **장마다 승인번호가 따로다.** 울산대 2026-05-18 은 당초(+) → 수정 취소(−) →
//      수정 재발행(+) 세 장이고, 셋을 다 넣어야 합계가 홈택스와 맞는다(1,650,000). 비고의 「당초 승인번호」
//      로 서로 잇는다.
import * as XLSX from "xlsx"
import { OUR_BIZ_NO, approvalNoIn, classifyItem, type InvoiceItem, type ParsedInvoice } from "@/lib/tax-invoice"

export interface ExcelSkip {
  approvalNo: string
  reason: string
}

export interface ExcelRead {
  invoices: ParsedInvoice[]
  skipped: ExcelSkip[]
  /** 매출 · 매입 어느 목록인지 (제목 줄에서) — 화면 안내용 */
  title: string | null
}


const text = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim())
const money = (v: unknown): number | null => {
  const s = text(v).replace(/[,\s원]/g, "")
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n) : null
}
const ymd = (v: unknown): string | null => {
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v)
    return d ? `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}` : null
  }
  const m = text(v).match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/)
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : null
}

/** 이 파일이 홈택스 목록조회 엑셀처럼 생겼는가 — 확장자가 아니라 머리줄로 본다 */
export function looksLikeHometaxExcel(fileName: string): boolean {
  return /\.(xls|xlsx)$/i.test(fileName)
}

export function readHometaxExcel(data: Uint8Array): ExcelRead {
  const wb = XLSX.read(data, { type: "array" })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null })

  const title = rows.slice(0, 6).flat().map(text).find((s) => /세금계산서\s*목록/.test(s)) ?? null
  const headerAt = rows.findIndex((r) => r.some((c) => text(c) === "승인번호") && r.some((c) => text(c) === "작성일자"))
  if (headerAt < 0) throw new Error("홈택스 목록조회 엑셀의 머리줄(작성일자 · 승인번호)을 찾지 못했습니다")
  const head = rows[headerAt].map(text)

  // 같은 이름의 칸(상호 · 대표자명)이 공급자와 공급받는자에 한 번씩 있다 — 사업자번호 칸 뒤에서 찾는다
  const at = (name: string, from = 0) => head.findIndex((h, i) => i >= from && h === name)
  const supBiz = head.findIndex((h) => h.startsWith("공급자사업자"))
  const buyBiz = head.findIndex((h) => h.startsWith("공급받는자사업자"))
  if (supBiz < 0 || buyBiz < 0) throw new Error("공급자 · 공급받는자 사업자등록번호 칸을 찾지 못했습니다")
  const col = {
    writtenOn: at("작성일자"),
    approvalNo: at("승인번호"),
    supBiz,
    supName: at("상호", supBiz),
    supCeo: at("대표자명", supBiz),
    buyBiz,
    buyName: at("상호", buyBiz),
    buyCeo: at("대표자명", buyBiz),
    total: at("합계금액"),
    supply: at("공급가액"),
    tax: at("세액"),
    kind: at("전자세금계산서분류"),
    note: at("비고"),
    itemDate: at("품목일자"),
    itemName: at("품목명"),
    itemSpec: at("품목규격"),
    itemQty: at("품목수량"),
    itemUnit: at("품목단가"),
    itemSupply: at("품목공급가액"),
    itemTax: at("품목세액"),
  }
  const cell = (r: unknown[], i: number) => (i >= 0 ? r[i] : null)

  // 승인번호로 묶는다 — 여러 줄이면 품목 줄이다
  const groups = new Map<string, unknown[][]>()
  for (const r of rows.slice(headerAt + 1)) {
    // 민간 발행 서비스로 나간 계산서는 승인번호에 영문이 섞인다 — PDF 판독과 같은 모양으로 맞춰야 첨부가 붙는다
    const no = approvalNoIn(text(cell(r, col.approvalNo)))
    if (!no) continue
    const key = `${no}|${money(cell(r, col.total))}`
    groups.set(key, [...(groups.get(key) ?? []), r])
  }

  const skipped: ExcelSkip[] = []

  const invoices: ParsedInvoice[] = []
  for (const [key, lines] of groups) {
    const [approvalNo] = key.split("|")
    const first = lines[0]
    const supplyKrw = money(cell(first, col.supply))
    const taxKrw = money(cell(first, col.tax))
    const totalKrw = money(cell(first, col.total))
    const kindText = text(cell(first, col.kind))
    const note = text(cell(first, col.note))

    const items: InvoiceItem[] = lines
      .map((r, i) => {
        const name = text(cell(r, col.itemName))
        return {
          lineNo: i + 1,
          date: ymd(cell(r, col.itemDate)),
          name,
          spec: text(cell(r, col.itemSpec)) || null,
          quantity: money(cell(r, col.itemQty)),
          unitKrw: money(cell(r, col.itemUnit)),
          supplyKrw: money(cell(r, col.itemSupply)) ?? 0,
          taxKrw: money(cell(r, col.itemTax)) ?? 0,
          category: classifyItem(name),
        }
      })
      .filter((it) => it.name)

    // 목록에는 첫 품목만 온다 — 모자라는 만큼 한 줄로 채워 합계를 맞춘다(제품 · 용역은 첫 품목을 따른다)
    const itemSupply = items.reduce((a, it) => a + it.supplyKrw, 0)
    const itemTax = items.reduce((a, it) => a + it.taxKrw, 0)
    if (supplyKrw !== null && taxKrw !== null && (itemSupply !== supplyKrw || itemTax !== taxKrw)) {
      items.push({
        lineNo: items.length + 1,
        date: items[0]?.date ?? null,
        name: "(홈택스 목록에 나오지 않은 품목)",
        spec: null,
        quantity: null,
        unitKrw: null,
        supplyKrw: supplyKrw - itemSupply,
        taxKrw: taxKrw - itemTax,
        category: items[0]?.category ?? "제품",
      })
    }

    const supplierBizNo = text(cell(first, col.supBiz)) || null
    const buyerBizNo = text(cell(first, col.buyBiz)) || null
    const problems: string[] = []
    if (supplyKrw === null || taxKrw === null || totalKrw === null) problems.push("금액 칸이 비어 있음")
    else if (supplyKrw + taxKrw !== totalKrw) problems.push(`공급가액 + 세액 ≠ 합계 (${supplyKrw + taxKrw} ≠ ${totalKrw})`)
    const direction = supplierBizNo === OUR_BIZ_NO ? "SALE" : buyerBizNo === OUR_BIZ_NO ? "PURCHASE" : null
    if (!direction) problems.push("우리 사업자번호가 공급자에도 공급받는자에도 없음")

    invoices.push({
      approvalNo,
      issuedOn: ymd(cell(first, col.writtenOn)),
      supplierBizNo,
      supplierName: text(cell(first, col.supName)) || null,
      supplierCeo: text(cell(first, col.supCeo)) || null,
      buyerBizNo,
      buyerName: text(cell(first, col.buyName)) || null,
      buyerCeo: text(cell(first, col.buyCeo)) || null,
      supplyKrw,
      taxKrw,
      totalKrw,
      modifyReason: kindText.includes("수정") ? note || null : null,
      kind: kindText.includes("수정") ? "수정" : "일반",
      originalApprovalNo: kindText.includes("수정") ? approvalNoIn(note) : null,
      items,
      direction,
      readBy: "excel",
      checks: { itemsSumMatches: true, totalMatches: problems.length === 0, problems },
    })
  }

  invoices.sort((a, b) => (a.issuedOn ?? "").localeCompare(b.issuedOn ?? ""))
  return { invoices, skipped, title }
}
