// 홈택스 전자세금계산서 PDF 판독.
//
// 두 단으로 읽는다.
//   1. PDF 글자 — unpdf 로 글자 조각과 좌표를 꺼내 칸을 좌표로 배정한다. 서버리스에서 돈다(로컬 pdftotext 는 Vercel 에 없다).
//      줄 글자로 읽지 않는 이유: 상호가 「상호」·「(법인명)」 두 줄에 걸쳐 나뉘고, 긴 품목명이 숫자 줄 위아래로 줄바꿈된다.
//   2. 글자가 없거나 검산이 틀리면 Gemini 에 PDF 를 그대로 보여 같은 칸을 읽게 한다 (readBy="vision" — 사람 확인 필수).
//
// 어느 쪽이든 같은 검산을 돌린다: 품목 공급가 합 = 공급가액, 공급가액 + 세액 = 합계금액.
// NAS 의 docs/processed/*.md 변환본은 쓰지 않는다 — 공급자와 공급받는자를 뒤바꿔 적은 사례가 있다(2026-09-14).
// 실측·설계: mydocs/plans/2026-09-14-company-context.md
import { getDocumentProxy } from "unpdf"

export const OUR_BIZ_NO = "503-52-46329"

export interface InvoiceItem {
  lineNo: number
  date: string | null
  name: string
  spec: string | null
  quantity: number | null
  unitKrw: number | null
  supplyKrw: number
  taxKrw: number
  category: "제품" | "용역"
}

export interface ParsedInvoice {
  approvalNo: string | null
  issuedOn: string | null
  supplierBizNo: string | null
  supplierName: string | null
  supplierCeo: string | null
  buyerBizNo: string | null
  buyerName: string | null
  buyerCeo: string | null
  supplyKrw: number | null
  taxKrw: number | null
  totalKrw: number | null
  modifyReason: string | null
  kind: "일반" | "수정"
  /** 수정세금계산서의 당초 승인번호 (수정사유에 적혀 온다) */
  originalApprovalNo: string | null
  items: InvoiceItem[]
  direction: "SALE" | "PURCHASE" | null
  /** text(PDF 글자) · vision(AI 판독) · excel(홈택스 목록조회 엑셀) */
  readBy: "text" | "vision" | "excel"
  checks: { itemsSumMatches: boolean; totalMatches: boolean; problems: string[] }
}

interface Piece { str: string; x: number; y: number; w: number; cx: number }
interface Line { y: number; pieces: Piece[] }

const BIZ = /\b\d{3}-\d{2}-\d{5}\b/
const NUM = /^-?[\d,]+$/
/** 수정사유 "기재사항착오정정 당초 승인번호 (20250923-…)" 에서 당초 승인번호 */
const originalOf = (reason: string | null) => approvalNoIn(reason?.match(/당초\s*승인\s*번호\s*\(?\s*([\dA-Za-z-]{24,26})/)?.[1])

/**
 * 승인번호 — 작성일 8자리 · 발행 사업자 8자 · 일련 8자. 홈택스가 발행하면 전부 숫자지만
 * **민간 발행 서비스(ASP)는 뒤 두 칸에 영문이 섞인다** — 엘지유플러스 `20250304-50000035-a8166145`,
 * 테크타워 `20250429-41000061-4a2f7wwg`. 네이버클라우드는 하이픈 없이 24자로 붙여 찍는다.
 * 숫자 8-8-8 만 찾다가 NAS 매입 42장 중 대부분을 놓쳤다(2026-09-17). 찾으면 하이픈 형태로 맞춘다.
 */
export function approvalNoIn(text: string | null | undefined): string | null {
  if (!text) return null
  const m = text.match(/(?<![\dA-Za-z])(\d{8})-?([\dA-Za-z]{8})-?([\dA-Za-z]{8})(?![\dA-Za-z])/)
  return m ? `${m[1]}-${m[2]}-${m[3]}`.toLowerCase() : null
}
const toNum = (s: string | null | undefined) => (s && NUM.test(s.trim()) ? Number(s.replace(/,/g, "")) : null)

/** 용역 · 기술료 성격의 품목. 나머지는 제품 */
export function classifyItem(name: string): "제품" | "용역" {
  return /용역|기술개발|컨설팅|위탁|분석\s*서비스|자문|교육|라이선스|기술료|서비스료/.test(name) ? "용역" : "제품"
}

/** unpdf 로 첫 쪽의 글자 조각을 좌표와 함께 꺼내 줄로 묶는다 (위에서 아래로) */
export async function pdfLines(data: Uint8Array): Promise<{ lines: Line[]; pageWidth: number; pieceCount: number }> {
  // pdf.js 는 받은 버퍼를 워커로 넘기며 비워 버린다(detach). 같은 버퍼로 비전 판독을 이어 하면 빈 파일이 가서
  // Gemini 가 400 을 돌려준다(2026-09-14 이식). 그래서 복사본을 넘긴다.
  const pdf = await getDocumentProxy(data.slice())
  const page = await pdf.getPage(1)
  const pageWidth = page.getViewport({ scale: 1 }).width
  const tc = await page.getTextContent()
  const pieces: Piece[] = (tc.items as { str?: string; transform?: number[]; width?: number }[])
    .filter((i) => typeof i.str === "string" && i.str.trim() !== "" && i.transform)
    .map((i) => ({ str: i.str!.trim(), x: i.transform![4], y: i.transform![5], w: i.width ?? 0, cx: i.transform![4] + (i.width ?? 0) / 2 }))
  const lines: Line[] = []
  for (const p of pieces.sort((a, b) => b.y - a.y)) {
    const line = lines.find((l) => Math.abs(l.y - p.y) <= 2.5)
    if (line) line.pieces.push(p)
    else lines.push({ y: p.y, pieces: [p] })
  }
  for (const l of lines) {
    l.pieces.sort((a, b) => a.x - b.x)
    // 머리 칸 글자(등록 · 번호 · 성명 · 사업자번호)가 한 글자씩 따로 그려져 있다 — 간격이 거의 없으면 한 조각으로 합친다
    const merged: Piece[] = []
    for (const p of l.pieces) {
      const last = merged[merged.length - 1]
      if (last && p.x - (last.x + last.w) <= 1.5) {
        last.str += p.str
        last.w = p.x + p.w - last.x
        last.cx = last.x + last.w / 2
      } else merged.push({ ...p })
    }
    l.pieces = merged
  }
  return { lines: lines.sort((a, b) => b.y - a.y), pageWidth, pieceCount: pieces.length }
}

const has = (l: Line, s: string) => l.pieces.some((p) => p.str === s)
const find = (l: Line, s: string) => l.pieces.filter((p) => p.str === s)

export function parseFromLines(lines: Line[], pageWidth: number): Omit<ParsedInvoice, "readBy" | "checks" | "direction"> {
  const all = lines.flatMap((l) => l.pieces.map((p) => p.str)).join(" ")
  const approvalNo = approvalNoIn(all.match(/승인\s*번호\s*:?\s*([\dA-Za-z-]{24,26})/)?.[1]) ?? approvalNoIn(all)

  // 공급자 · 공급받는자 경계 — 「등록」 머리가 두 번 나오는 줄의 두 번째 「등록」 x
  const regIdx = lines.findIndex((l) => find(l, "등록").length >= 2)
  // 공급받는자 블록의 이름표들이 모두 같은 x 에서 시작하지 않는다 — 「(법인명)」(x324) 이 「등록」(x331) 보다 왼쪽이다.
  // 두 번씩 나오는 이름표의 두 번째 자리 중 가장 왼쪽을 경계로 잡는다. 못 찾으면 쪽 가운데.
  const secondX = ["등록", "상호", "(법인명)", "사업장", "주소", "업태", "이메일"]
    .map((label) => lines.flatMap((l) => find(l, label)).sort((a, b) => a.x - b.x)[1]?.x)
    .filter((x): x is number => typeof x === "number" && x > pageWidth * 0.3)
  const splitX = secondX.length ? Math.min(...secondX) - 2 : pageWidth / 2
  const side = (p: Piece) => (p.x < splitX ? "S" : "B")
  const vertical = new Set(["공", "급", "받", "는", "자"])
  const labels = new Set(["등록", "번호", "종사업장", "상호", "(법인명)", "성명"])

  // 머리 칸 값은 이름표와 같은 줄에 있지 않다 — 「등록」·「번호」 줄 사이 줄에 사업자번호가,
  // 「상호」·「(법인명)」 줄 사이 줄에 상호·성명이 있다(2026-09-14 좌표 실측). 그래서 이름표 사이의 띠에서 찾는다.
  const bizIdxEnd = lines.findIndex((l, i) => i > regIdx && has(l, "상호"))
  const bizBand = lines.slice(Math.max(regIdx, 0), bizIdxEnd > 0 ? bizIdxEnd : undefined).flatMap((l) => l.pieces)
  const bizOf = (s: "S" | "B") => bizBand.find((p) => side(p) === s && BIZ.test(p.str))?.str.match(BIZ)?.[0] ?? null

  const nameOf = (s: "S" | "B") => {
    const topIdx = lines.findIndex((l) => l.pieces.some((p) => p.str === "상호" && side(p) === s))
    const botIdx = lines.findIndex((l, i) => i >= topIdx && l.pieces.some((p) => p.str === "(법인명)" && side(p) === s))
    if (topIdx < 0 || botIdx < 0) return { name: null, ceo: null }
    const band = lines.slice(topIdx, botIdx + 1)
    const pieces = band.flatMap((l) => l.pieces.map((p) => ({ ...p, lineY: l.y }))).filter((p) => side(p) === s)
    const labelEnd = Math.max(...pieces.filter((p) => p.str === "상호" || p.str === "(법인명)").map((p) => p.x + p.w))
    const ceoLabel = pieces.find((p) => p.str === "성명")
    const right = ceoLabel ? ceoLabel.x : splitX
    const name = pieces
      .filter((p) => p.x >= labelEnd - 1 && p.x + p.w <= right + 1 && !labels.has(p.str) && !vertical.has(p.str))
      .sort((a, b) => b.lineY - a.lineY || a.x - b.x)
      .map((p) => p.str)
      .join("")
      .trim()
    const ceo = ceoLabel
      ? pieces.filter((p) => p.lineY === ceoLabel.lineY && p.x > ceoLabel.x + ceoLabel.w && !vertical.has(p.str) && !labels.has(p.str)).sort((a, b) => a.x - b.x)[0]?.str ?? null
      : null
    return { name: name || null, ceo }
  }
  const S = nameOf("S"); const B = nameOf("B")

  // 작성일자 · 공급가액 · 세액 · 수정사유 — 날짜 다음 숫자 두 개가 공급가액·세액, 그 뒤 글자 중 「비고」 머리 왼쪽이 수정사유
  let issuedOn: string | null = null, supplyKrw: number | null = null, taxKrw: number | null = null, modifyReason: string | null = null
  const sumHeadIdx = lines.findIndex((l) => has(l, "작성일자") && has(l, "공급가액"))
  if (sumHeadIdx >= 0) {
    const bigo = find(lines[sumHeadIdx], "비고")[0]
    const row = lines.slice(sumHeadIdx + 1, sumHeadIdx + 3).find((l) => l.pieces.some((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.str)))
    if (row) {
      const di = row.pieces.findIndex((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.str))
      issuedOn = row.pieces[di].str
      const after = row.pieces.slice(di + 1)
      const nums = after.filter((p) => NUM.test(p.str))
      supplyKrw = toNum(nums[0]?.str)
      taxKrw = toNum(nums[1]?.str)
      const texts = after.filter((p) => !NUM.test(p.str) && (!bigo || p.x < bigo.x - 10))
      modifyReason = texts.map((p) => p.str).join(" ") || null
    }
  }

  // 품목 표 — 머리(월 일 품목 규격 수량 단가 공급가액 세액 비고)부터 합계금액 머리 전까지.
  // 가운데 좌표로 칸을 배정하면 짧은 품목명이 좁은 「일」 칸으로 간다. 그래서 줄 모양으로 읽는다:
  //   월 · 일 · (품목명 조각들) · [규격] · 수량 · 단가 · 공급가액 · 세액 · [비고]
  // 긴 품목명은 숫자 줄 위아래로 줄바꿈된다 — 숫자 없는 줄의 품목 칸 조각을 가장 가까운 품목 줄에 붙인다.
  const items: InvoiceItem[] = []
  const itemHeadIdx = lines.findIndex((l) => has(l, "품목") && has(l, "단가"))
  const totalHeadIdx = lines.findIndex((l) => has(l, "합계금액"))
  if (itemHeadIdx >= 0) {
    const head = lines[itemHeadIdx]
    const specHead = find(head, "규격")[0]
    const qtyHead = find(head, "수량")[0]
    const bigoHead = find(head, "비고")[0]
    const nameRight = specHead ? specHead.x - 4 : qtyHead ? qtyHead.x - 4 : Infinity
    const body = lines.slice(itemHeadIdx + 1, totalHeadIdx > itemHeadIdx ? totalHeadIdx : undefined)
    const isAnchor = (l: Line) => l.pieces.length >= 4 && /^\d{2}$/.test(l.pieces[0].str) && /^\d{2}$/.test(l.pieces[1].str) && l.pieces.filter((p) => NUM.test(p.str)).length >= 4
    const anchors = body.filter(isAnchor)
    const fragments = new Map<Line, { y: number; x: number; s: string }[]>(anchors.map((a) => [a, []]))
    for (const l of body) {
      const pieces = isAnchor(l) ? l.pieces.slice(2) : l.pieces
      const nameParts = pieces.filter((p) => !NUM.test(p.str) && p.x + p.w <= nameRight + 2 && (!bigoHead || p.x < bigoHead.x - 10))
      if (nameParts.length === 0 || anchors.length === 0) continue
      const target = isAnchor(l) ? l : anchors.reduce((a, b) => (Math.abs(b.y - l.y) < Math.abs(a.y - l.y) ? b : a))
      for (const p of nameParts) fragments.get(target)!.push({ y: l.y, x: p.x, s: p.str })
    }
    anchors.forEach((a, i) => {
      const rest = a.pieces.slice(2).filter((p) => !bigoHead || p.x < bigoHead.x - 10)
      const nums = rest.filter((p) => NUM.test(p.str)).map((p) => toNum(p.str) ?? 0)
      const [tax, supply, unit, qty] = [nums[nums.length - 1], nums[nums.length - 2], nums[nums.length - 3], nums[nums.length - 4]]
      const spec = rest.find((p) => !NUM.test(p.str) && specHead && p.x > nameRight - 2 && (!qtyHead || p.x < qtyHead.x + qtyHead.w))?.str ?? null
      const parts = fragments.get(a)!.sort((p, q) => q.y - p.y || p.x - q.x)
      // 같은 줄 조각은 띄어 쓰고, 줄바꿈으로 끊긴 조각은 붙인다 ("(연구" + "전용)")
      let name = ""
      parts.forEach((p, j) => { name += j === 0 ? p.s : parts[j - 1].y === p.y ? " " + p.s : p.s })
      items.push({
        lineNo: i + 1,
        date: `${a.pieces[0].str}-${a.pieces[1].str}`,
        name: name.trim(),
        spec,
        quantity: nums.length >= 4 ? qty : null,
        unitKrw: nums.length >= 3 ? unit : null,
        supplyKrw: supply ?? 0,
        taxKrw: tax ?? 0,
        category: classifyItem(name),
      })
    })
  }

  // 합계금액 — 머리 아래 60pt 안의 첫 숫자
  let totalKrw: number | null = null
  if (totalHeadIdx >= 0) {
    const head = find(lines[totalHeadIdx], "합계금액")[0]
    for (const l of lines.slice(totalHeadIdx + 1)) {
      if (head.y - l.y > 60) break
      const n = l.pieces.find((p) => NUM.test(p.str) && Math.abs(p.cx - head.cx) < 60)
      if (n) { totalKrw = toNum(n.str); break }
    }
  }

  const kind = modifyReason && !/해당\s*없음/.test(modifyReason) ? "수정" : "일반"
  return {
    approvalNo, issuedOn, supplierBizNo: bizOf("S"), supplierName: S.name, supplierCeo: S.ceo,
    buyerBizNo: bizOf("B"), buyerName: B.name, buyerCeo: B.ceo, supplyKrw, taxKrw, totalKrw, modifyReason, kind,
    originalApprovalNo: originalOf(modifyReason), items,
  }
}

export function checkInvoice(p: Omit<ParsedInvoice, "checks" | "direction">): ParsedInvoice {
  const problems: string[] = []
  if (!p.approvalNo) problems.push("승인번호를 못 읽음")
  if (!p.issuedOn) problems.push("작성일자를 못 읽음")
  if (!p.supplierBizNo || !p.buyerBizNo) problems.push("사업자등록번호를 못 읽음")
  if (!p.supplierName || !p.buyerName) problems.push("상호를 못 읽음")
  if (p.supplyKrw === null || p.taxKrw === null) problems.push("공급가액·세액을 못 읽음")
  if (p.items.length === 0) problems.push("품목을 못 읽음")
  const itemsSum = p.items.reduce((a, i) => a + i.supplyKrw, 0)
  const itemsSumMatches = p.items.length > 0 && p.supplyKrw !== null && itemsSum === p.supplyKrw
  if (p.items.length > 0 && p.supplyKrw !== null && !itemsSumMatches) problems.push(`품목 합 ${itemsSum.toLocaleString()} ≠ 공급가액 ${p.supplyKrw.toLocaleString()}`)
  const totalMatches = p.supplyKrw !== null && p.taxKrw !== null && p.totalKrw !== null && p.supplyKrw + p.taxKrw === p.totalKrw
  if (p.totalKrw !== null && p.supplyKrw !== null && p.taxKrw !== null && !totalMatches) problems.push(`공급가액+세액 ≠ 합계 (${p.supplyKrw}+${p.taxKrw}≠${p.totalKrw})`)
  if (p.totalKrw === null) problems.push("합계금액을 못 읽음")
  const direction = p.supplierBizNo === OUR_BIZ_NO ? "SALE" : p.buyerBizNo === OUR_BIZ_NO ? "PURCHASE" : null
  if (!direction && p.supplierBizNo && p.buyerBizNo) problems.push(`우리 사업자번호(${OUR_BIZ_NO})가 공급자에도 공급받는자에도 없다`)
  return { ...p, direction, checks: { itemsSumMatches, totalMatches, problems } }
}

/** 1단 — PDF 글자로 읽는다. 글자가 거의 없으면 null (이미지 PDF) */
export async function readInvoiceText(data: Uint8Array): Promise<ParsedInvoice | null> {
  const { lines, pageWidth, pieceCount } = await pdfLines(data)
  if (pieceCount < 20) return null
  return checkInvoice({ ...parseFromLines(lines, pageWidth), readBy: "text" })
}

/** 2단 — Gemini 에 PDF 를 그대로 보여 같은 칸을 읽게 한다. 사람이 확인해야 저장한다 */
export async function readInvoiceVision(data: Uint8Array, mimeType: string, userId?: string): Promise<ParsedInvoice> {
  const { callGemini } = await import("@/lib/ai")
  const prompt = `이 문서는 한국 국세청 홈택스 전자세금계산서다. 보이는 값만 그대로 옮겨라. 추측하지 마라. 안 보이면 null.
왼쪽 블록이 「공급자」, 오른쪽 블록이 「공급받는자」다. 두 블록을 뒤바꾸지 마라.
금액은 쉼표 없는 정수. 날짜는 YYYY-MM-DD. 품목은 표의 줄마다 하나.

JSON 만:
{"approvalNo":"########-########-########","issuedOn":"YYYY-MM-DD",
 "supplierBizNo":"###-##-#####","supplierName":"","supplierCeo":"",
 "buyerBizNo":"###-##-#####","buyerName":"","buyerCeo":"",
 "supplyKrw":0,"taxKrw":0,"totalKrw":0,"modifyReason":"해당없음",
 "items":[{"date":"MM-DD","name":"","spec":null,"quantity":0,"unitKrw":0,"supplyKrw":0,"taxKrw":0}]}`
  const raw = await callGemini(prompt, "taxInvoiceVision", userId, 0, {
    model: process.env.OMNIS_VISION_MODEL ?? "gemini-3.8-flash",
    files: [{ mimeType, data: Buffer.from(data).toString("base64") }],
  })
  const m = raw.match(/\{[\s\S]*\}/)
  const j = (m ? JSON.parse(m[0]) : {}) as Record<string, unknown> & { items?: Record<string, unknown>[] }
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)
  const n = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" ? toNum(v) : null)
  const modifyReason = s(j.modifyReason)
  return checkInvoice({
    approvalNo: approvalNoIn(s(j.approvalNo)), issuedOn: s(j.issuedOn),
    supplierBizNo: s(j.supplierBizNo), supplierName: s(j.supplierName), supplierCeo: s(j.supplierCeo),
    buyerBizNo: s(j.buyerBizNo), buyerName: s(j.buyerName), buyerCeo: s(j.buyerCeo),
    supplyKrw: n(j.supplyKrw), taxKrw: n(j.taxKrw), totalKrw: n(j.totalKrw), modifyReason,
    kind: modifyReason && !/해당\s*없음/.test(modifyReason) ? "수정" : "일반",
    originalApprovalNo: originalOf(modifyReason),
    items: (j.items ?? []).map((it, i) => {
      const name = s(it.name) ?? ""
      return { lineNo: i + 1, date: s(it.date), name, spec: s(it.spec), quantity: n(it.quantity), unitKrw: n(it.unitKrw), supplyKrw: n(it.supplyKrw) ?? 0, taxKrw: n(it.taxKrw) ?? 0, category: classifyItem(name) }
    }),
    readBy: "vision",
  })
}

/** 글자로 읽고, 못 읽거나 검산이 틀리면 비전으로 다시 읽는다 */
export async function readInvoice(data: Uint8Array, mimeType = "application/pdf", opts: { userId?: string; allowVision?: boolean } = {}): Promise<ParsedInvoice> {
  const text = mimeType === "application/pdf" ? await readInvoiceText(data) : null
  if (text && text.checks.problems.length === 0) return text
  if (opts.allowVision === false) {
    return text ?? checkInvoice({ approvalNo: null, issuedOn: null, supplierBizNo: null, supplierName: null, supplierCeo: null, buyerBizNo: null, buyerName: null, buyerCeo: null, supplyKrw: null, taxKrw: null, totalKrw: null, modifyReason: null, kind: "일반", originalApprovalNo: null, items: [], readBy: "text" })
  }
  return readInvoiceVision(data, mimeType, opts.userId)
}
