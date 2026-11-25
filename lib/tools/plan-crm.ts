// 묶음 2(#248) 실행 — CRM 나머지. 정의는 lib/tools/defs-crm.ts.
// 쓰기는 계획(WritePlan)을 세우고, run 은 화면 API 가 부르는 서버 함수(lib/crm-ops.ts · lib/tax-invoice-import.ts)를 그대로 부른다.
import { rowProductLabel } from "@/lib/crm-gel"
import { prisma } from "@/lib/db"
import type { Caller } from "@/lib/omnis-mcp"
import {
  acceptInquiry, createContact, deletePayment, deleteStockMove, deleteTaxInvoice, linkTaxInvoice,
  rejectInquiry, settlePayments,
} from "@/lib/crm-ops"
import { receivableChains } from "@/lib/crm-receivables"
import { findVisibleFile } from "@/lib/file-access-server"
import { openFileObject } from "@/lib/file-object"
import { ImportUserError, importInvoices, readInvoiceSource, type ImportDecisions } from "@/lib/tax-invoice-import"
import { loadOrgsForMatching, planInvoice, saveBlockers } from "@/lib/tax-invoice-save"
import { blocked, clip, kstDate, str, type Planner } from "./planned"
import type { CrmMoreReadName, CrmMoreWriteName } from "./defs-crm"

const won = (n: number | bigint) => `${Number(n).toLocaleString("ko-KR")}원`
const isUuid = (k: string) => /^[0-9a-f-]{36}$/i.test(k)
const INQ_STATUS: Record<string, string> = { NEW: "검토 대기", ACCEPTED: "승인", REJECTED: "반려", SPAM: "스팸" }
const OUTCOME: Record<string, string> = { quote: "빈 견적 만들기", sample: "샘플요청 만들기", none: "기관 · 담당자만 잇기" }

async function orgByRef(ref: string) {
  const k = ref.trim()
  if (!k) return null
  return prisma.crmOrg.findFirst({ where: isUuid(k) ? { id: k } : { code: { equals: k, mode: "insensitive" } }, select: { id: true, code: true, name: true } })
}

async function productByRef(ref: string) {
  const k = ref.trim()
  if (isUuid(k)) return prisma.crmProduct.findMany({ where: { id: k }, select: { id: true, code: true, name: true, spec: true } })
  const byCode = await prisma.crmProduct.findMany({ where: { code: { equals: k, mode: "insensitive" } }, select: { id: true, code: true, name: true, spec: true } })
  if (byCode.length) return byCode
  return prisma.crmProduct.findMany({ where: { archived: false, name: { contains: k, mode: "insensitive" } }, select: { id: true, code: true, name: true, spec: true }, take: 10 })
}

// ─── 읽기 ───

export async function runCrmMoreRead(name: CrmMoreReadName, args: Record<string, unknown>): Promise<{ text: string } | { error: string }> {
  switch (name) {
    case "list_stock_moves": {
      const take = Math.min(Math.max(Number(args.limit) || 30, 1), 100)
      let productIds: string[] | undefined
      if (str(args.product)) {
        const ps = await productByRef(str(args.product))
        if (ps.length === 0) return { error: `'${str(args.product)}' 제품이 없습니다 — list_products 로 확인하세요.` }
        if (ps.length > 1) return { error: [`제품이 ${ps.length}개 걸립니다 — product 에 ID 나 코드를 주세요.`, ...ps.map((p) => `- ${p.name}${p.spec ? ` ${p.spec}` : ""} · ${p.code} · id=${p.id}`)].join("\n") }
        productIds = [ps[0].id]
      }
      const rows = await prisma.crmStockMove.findMany({
        where: productIds ? { productId: { in: productIds } } : {},
        orderBy: [{ movedAt: "desc" }, { createdAt: "desc" }], take,
        include: { product: { select: { name: true, spec: true, stockUnit: true, gelType: true } }, shipment: { select: { code: true } }, production: { select: { code: true } } },
      })
      if (rows.length === 0) return { text: "재고 장부 줄이 없습니다." }
      return {
        text: [
          `재고 장부 ${rows.length}줄(최근 것부터) — 직접 적은 줄만 delete_stock_move 로 지운다(출고 · 생산 줄은 그 기록을 지운다).`,
          ...rows.map((m) => [
            `- move_id=${m.id}`, kstDate(m.movedAt), rowProductLabel(m.product, m),
            `${m.direction === "IN" ? "+" : "−"}${Number(m.quantity)}${m.product.stockUnit === "ML" ? "ml" : m.product.stockUnit !== "PIECE" ? "g" : "개"}`,
            m.shipment ? `출고 ${m.shipment.code}` : m.production ? `생산 ${m.production.code}` : "직접 적음",
            m.note ? clip(m.note, 60) : null,
          ].filter(Boolean).join(" · ")),
        ].join("\n"),
      }
    }
    case "list_payments": {
      const id = str(args.invoice_id)
      const inv = id ? await prisma.taxInvoice.findUnique({ where: { id }, include: { payments: { orderBy: { paidOn: "asc" } } } }) : null
      if (!inv) return { error: "세금계산서를 찾지 못했습니다 — list_receivables 의 invoice_id 를 넣으세요." }
      const who = inv.direction === "SALE" ? inv.buyerName : inv.supplierName
      if (inv.payments.length === 0) return { text: `${who} · ${kstDate(inv.issuedOn)} 발행 · 합계 ${won(inv.totalKrw)} — 입금 기록 없음` }
      return {
        text: [
          `${who} · ${kstDate(inv.issuedOn)} 발행 · 합계 ${won(inv.totalKrw)} — ${inv.direction === "SALE" ? "입금" : "출금"} ${inv.payments.length}줄`,
          ...inv.payments.map((p) => `- payment_id=${p.id} · ${kstDate(p.paidOn)} · ${won(p.amountKrw)}${p.note ? ` · ${clip(p.note, 60)}` : ""}`),
        ].join("\n"),
      }
    }
    case "list_inquiries": {
      const st = str(args.status).toUpperCase() || "NEW"
      const take = Math.min(Math.max(Number(args.limit) || 20, 1), 100)
      const rows = await prisma.websiteInquiry.findMany({
        where: st === "ALL" ? {} : { status: st as "NEW" },
        orderBy: { createdAt: "desc" }, take,
        include: { org: { select: { name: true, code: true } } },
      })
      if (rows.length === 0) return { text: `${INQ_STATUS[st] ?? "해당"} 문의가 없습니다.` }
      return {
        text: [
          `홈페이지 문의 ${rows.length}건 — 처리는 decide_inquiry(inquiry_id).`,
          ...rows.map((q) => [
            `- inquiry_id=${q.id}`, kstDate(q.createdAt), INQ_STATUS[q.status], q.topic,
            `${q.name}${q.organization ? ` · ${q.organization}` : ""}`, clip(q.message.replace(/\s+/g, " "), 160),
            q.org ? `기관 ${q.org.name}(${q.org.code})` : null,
          ].filter(Boolean).join(" · ")),
        ].join("\n"),
      }
    }
  }
}

// ─── 쓰기 계획 ───

const planDeleteStockMove: Planner = async (args) => {
  const T = "재고 장부 줄 지우기"
  const m = str(args.move_id) ? await prisma.crmStockMove.findUnique({ where: { id: str(args.move_id) }, include: { product: { select: { name: true, spec: true, stockUnit: true, gelType: true } } } }) : null
  if (!m) return blocked(T, str(args.move_id) || "(ID 없음)", "장부 줄을 찾지 못했습니다 — list_stock_moves 의 move_id 를 넣으세요")
  const unit = m.product.stockUnit === "ML" ? "ml" : m.product.stockUnit !== "PIECE" ? "g" : "개"
  const q = Number(m.quantity)
  return {
    title: T, target: rowProductLabel(m.product, m),
    changes: [
      { label: "지울 줄", before: `${kstDate(m.movedAt)} · ${m.direction === "IN" ? "+" : "−"}${q}${unit}${m.note ? ` · ${clip(m.note, 60)}` : ""}`, after: "지움" },
      { label: "재고", before: "지금", after: `${m.direction === "IN" ? "−" : "+"}${q}${unit}` },
    ],
    risk: "장부 줄이 지워지고 재고가 그만큼 바뀝니다. 되돌릴 수 없습니다.",
    confirmLabel: "지우기",
    ...(m.shipmentId || m.productionId ? { problem: "생산 · 출고에서 나온 줄입니다. 그 기록(생산은 delete_production, 출고는 delete_shipment)을 지워야 함께 사라집니다" } : {}),
    run: async () => {
      const r = await deleteStockMove(m.id)
      return r.ok ? { ok: true, id: m.id, text: "장부 줄을 지웠습니다." } : { ok: false, error: r.error }
    },
  }
}

const planDeletePayment: Planner = async (args, caller) => {
  const T = "입금 기록 지우기"
  const p = str(args.payment_id) ? await prisma.crmPayment.findUnique({ where: { id: str(args.payment_id) }, include: { invoice: { select: { buyerName: true, supplierName: true, direction: true } } } }) : null
  if (!p) return blocked(T, str(args.payment_id) || "(ID 없음)", "입금 기록을 찾지 못했습니다 — list_payments 의 payment_id 를 넣으세요")
  const who = p.invoice.direction === "SALE" ? p.invoice.buyerName : p.invoice.supplierName
  return {
    title: T, target: who,
    changes: [{ label: "지울 줄", before: `${kstDate(p.paidOn)} · ${won(p.amountKrw)}${p.note ? ` · ${clip(p.note, 60)}` : ""}`, after: "지움" }],
    risk: `${p.invoice.direction === "SALE" ? "받을" : "줄"} 돈이 ${won(p.amountKrw)} 늘어납니다. 활동 기록에 내 이름으로 남습니다.`,
    confirmLabel: "지우기",
    run: async () => {
      const r = await deletePayment(p.id, caller.userId)
      return r.ok ? { ok: true, id: p.id, text: "지웠습니다." } : { ok: false, error: r.error }
    },
  }
}

const planSettle: Planner = async (args, caller) => {
  const T = "시작 전 정리 — 받음으로 표시"
  const ids = Array.isArray(args.invoice_ids) ? [...new Set(args.invoice_ids.map(String).map((x) => x.trim()).filter(Boolean))] : []
  if (ids.length === 0 || ids.length > 500) return blocked(T, "", "invoice_ids 에 세금계산서 ID 를 1~500개 주세요 — list_receivables")
  const want = new Set(ids)
  const chains = (await receivableChains("SALE")).filter((c) => want.has(c.invoiceId) && c.remaining > 0)
  return {
    title: T, target: `매출 세금계산서 ${chains.length}장`,
    changes: chains.slice(0, 30).map((c) => ({ label: `${c.counterName} · ${c.issuedOn}`, before: `남은 ${won(c.remaining)}`, after: "받음(발행일 · 실제 입금일 모름)" })),
    risk: "입금일을 지어 넣지 않고 발행일로 둡니다. 「실제 입금일 모름」 메모가 남고, 지우면(delete_payment) 되돌아갑니다.",
    ...(chains.length === 0 ? { problem: "받을 돈이 남은 매출 세금계산서가 없습니다" } : {}),
    run: async () => {
      const r = await settlePayments(chains.map((c) => c.invoiceId), caller.userId)
      return r.ok ? { ok: true, text: `${r.value.settled}장을 받음으로 표시했습니다 · ${won(r.value.total)}` } : { ok: false, error: r.error }
    },
  }
}

const planCreateContact: Planner = async (args) => {
  const T = "기관 담당자 추가"
  const org = await orgByRef(str(args.org))
  if (!org) return blocked(T, str(args.org) || "(기관 없음)", "기관을 찾지 못했습니다 — find_org 의 org_id 나 코드를 넣으세요")
  const name = str(args.name)
  if (!name) return blocked(T, org.name, "name(담당자 이름)이 비어 있습니다")
  const fields = { title: str(args.title) || null, phone: str(args.phone) || null, email: str(args.email) || null, note: str(args.note) || null }
  const LABEL: Record<string, string> = { title: "직함", phone: "전화", email: "메일", note: "메모" }
  return {
    title: T, target: `${org.name}(${org.code})`,
    changes: [{ label: "담당자", before: null, after: name }, ...Object.entries(fields).filter(([, v]) => v).map(([k, v]) => ({ label: LABEL[k], before: null, after: clip(v!) }))],
    risk: "기관에 담당자가 생깁니다. 견적 · 샘플요청에서 고를 수 있게 됩니다.",
    run: async () => {
      const r = await createContact({ orgId: org.id, name, ...fields })
      return r.ok ? { ok: true, id: r.value.id, text: `더했습니다: ${r.value.name} · ${r.value.code} · contact_id=${r.value.id}` } : { ok: false, error: r.error }
    },
  }
}

const planDecideInquiry: Planner = async (args, caller) => {
  const action = str(args.action)
  const T = action === "accept" ? "홈페이지 문의 승인" : action === "spam" ? "홈페이지 문의 스팸" : "홈페이지 문의 반려"
  const q = str(args.inquiry_id) ? await prisma.websiteInquiry.findUnique({ where: { id: str(args.inquiry_id) } }) : null
  if (!q) return blocked(T, str(args.inquiry_id) || "(ID 없음)", "문의를 찾지 못했습니다 — list_inquiries 의 inquiry_id 를 넣으세요")
  const target = `${kstDate(q.createdAt)} · ${q.name}${q.organization ? ` · ${q.organization}` : ""} · ${q.topic}`
  if (q.status !== "NEW") return blocked(T, target, `이미 처리된 문의입니다(${INQ_STATUS[q.status]})`)
  const note = str(args.note) || undefined
  if (action === "reject" || action === "spam") {
    const status = action === "spam" ? "SPAM" : "REJECTED"
    return {
      title: T, target,
      changes: [{ label: "상태", before: INQ_STATUS.NEW, after: INQ_STATUS[status] }, ...(note ? [{ label: "메모", before: null, after: clip(note) }] : [])],
      risk: "문의의 상태만 바뀝니다. CRM 기관 목록은 건드리지 않습니다.",
      run: async () => {
        const r = await rejectInquiry(q.id, caller.userId, { status, reviewNote: note })
        return r.ok ? { ok: true, id: q.id, text: `${INQ_STATUS[status]} 처리했습니다.` } : { ok: false, error: r.error }
      },
    }
  }
  if (action !== "accept") return blocked(T, target, "action 은 accept · reject · spam 중 하나입니다")
  const org = await orgByRef(str(args.org))
  if (!org) return blocked(T, target, "org(기관 org_id · 코드)가 필요합니다 — find_org 로 찾고, 없으면 create_org 로 먼저 만드세요")
  const outcome = str(args.outcome) || "none"
  if (!OUTCOME[outcome]) return blocked(T, target, "outcome 은 quote · sample · none 중 하나입니다")
  const contact = str(args.contact) ? await prisma.crmContact.findUnique({ where: { id: str(args.contact) }, select: { id: true, name: true, orgId: true } }) : null
  if (str(args.contact) && (!contact || contact.orgId !== org.id)) return blocked(T, target, "담당자가 이 기관 소속이 아닙니다 — find_org 의 contact_id 를 확인하세요")
  return {
    title: T, target,
    changes: [
      { label: "상태", before: INQ_STATUS.NEW, after: INQ_STATUS.ACCEPTED },
      { label: "기관", before: null, after: `${org.name}(${org.code})` },
      ...(contact ? [{ label: "담당자", before: null, after: contact.name }] : []),
      { label: "만들 것", before: null, after: OUTCOME[outcome] },
    ],
    risk: outcome === "quote" ? "품목이 빈 견적(작성중)이 생깁니다 — 품목은 사람이 채웁니다." : outcome === "sample" ? "제품이 빈 샘플요청이 생깁니다 — 보낼 제품은 사람이 고릅니다." : "문의를 기관에 잇기만 합니다.",
    run: async () => {
      const r = await acceptInquiry(q.id, caller.userId, { orgId: org.id, contactId: contact?.id ?? null, outcome, note })
      return r.ok ? { ok: true, id: q.id, text: `승인했습니다${r.value.code ? ` — ${outcome === "quote" ? "견적" : "샘플요청"} ${r.value.code}` : ""}` } : { ok: false, error: r.error }
    },
  }
}

const planLinkInvoice: Planner = async (args, caller) => {
  const T = "세금계산서 ↔ 견적 잇기"
  const inv = str(args.invoice_id) ? await prisma.taxInvoice.findUnique({ where: { id: str(args.invoice_id) }, include: { quote: { select: { code: true } } } }) : null
  if (!inv) return blocked(T, str(args.invoice_id) || "(ID 없음)", "세금계산서를 찾지 못했습니다 — list_receivables 의 invoice_id 를 넣으세요")
  const target = `${inv.direction === "SALE" ? inv.buyerName : inv.supplierName} · ${kstDate(inv.issuedOn)} · ${won(inv.totalKrw)}`
  const qref = str(args.quote_id)
  const quote = qref ? await prisma.crmQuote.findFirst({ where: isUuid(qref) ? { id: qref } : { code: { equals: qref, mode: "insensitive" } }, select: { id: true, code: true, taxInvoicedAt: true } }) : null
  if (qref && !quote) return blocked(T, target, "견적을 찾지 못했습니다 — list_quotes 의 quote_id 를 넣으세요")
  if (inv.direction !== "SALE" && quote) return blocked(T, target, "매입 세금계산서는 견적에 잇지 않습니다")
  return {
    title: quote ? T : "세금계산서 견적 연결 끊기", target,
    changes: [
      { label: "견적", before: inv.quote?.code ?? "(없음)", after: quote?.code ?? "(끊음)" },
      ...(quote && !quote.taxInvoicedAt ? [{ label: `견적 ${quote.code} 발행일`, before: "(없음)", after: kstDate(inv.issuedOn) }] : []),
    ],
    risk: "견적 화면의 세금계산서 표시와 미수금 묶음이 바뀝니다. 활동 기록에 남습니다.",
    ...(quote?.id === inv.quoteId || (!quote && !inv.quoteId) ? { problem: "바뀌는 것이 없습니다" } : {}),
    run: async () => {
      const r = await linkTaxInvoice(inv.id, quote?.id ?? null, caller.userId)
      return r.ok ? { ok: true, id: inv.id, text: r.value.quoteCode ? `이었습니다: 견적 ${r.value.quoteCode}` : "연결을 끊었습니다." } : { ok: false, error: r.error }
    },
  }
}

const planDeleteInvoice: Planner = async (args, caller) => {
  const T = "세금계산서 지우기"
  const inv = str(args.invoice_id) ? await prisma.taxInvoice.findUnique({ where: { id: str(args.invoice_id) }, include: { _count: { select: { payments: true } }, quote: { select: { code: true } } } }) : null
  if (!inv) return blocked(T, str(args.invoice_id) || "(ID 없음)", "세금계산서를 찾지 못했습니다 — list_receivables · list_tax_invoices 로 확인하세요")
  const who = inv.direction === "SALE" ? inv.buyerName : inv.supplierName
  return {
    title: T, target: `${who} · ${kstDate(inv.issuedOn)} · 승인번호 ${inv.approvalNo}`,
    changes: [
      { label: "지울 세금계산서", before: `${inv.direction === "SALE" ? "매출" : "매입"} · 합계 ${won(inv.totalKrw)}${inv.quote ? ` · 견적 ${inv.quote.code}` : ""}`, after: "지움" },
      ...(inv._count.payments ? [{ label: "입금 기록", before: `${inv._count.payments}줄`, after: "함께 지움" }] : []),
    ],
    risk: "세금계산서와 그 입금 기록이 지워져 매출 · 미수금이 바뀝니다. 원본 PDF 는 NAS 에 남습니다. 수정세금계산서라면 지우지 말고 취소 · 재발행 장을 올리세요.",
    warning: inv.kind === "수정" ? "수정세금계산서입니다 — 지우면 당초 · 수정 묶음이 어긋납니다." : undefined,
    confirmLabel: "지우기",
    run: async () => {
      const r = await deleteTaxInvoice(inv.id, caller.userId)
      return r.ok ? { ok: true, id: inv.id, text: `지웠습니다${r.value.payments ? ` — 입금 기록 ${r.value.payments}줄도 함께` : ""}.` } : { ok: false, error: r.error }
    },
  }
}

const planImportInvoice: Planner = async (args, caller) => {
  const T = "세금계산서 올리기"
  const id = str(args.file)
  // 내가 볼 수 있는 파일만 — 화면에서 파일을 고르는 것과 같다(lib/file-access)
  const visible = id ? await findVisibleFile(id, caller.userId) : null
  const f = visible ? await prisma.file.findUnique({ where: { id }, select: { id: true, name: true, path: true, size: true, mimeType: true } }) : null
  if (!f) return blocked(T, id || "(파일 없음)", "파일을 찾지 못했습니다 — upload_file 로 올린 파일 ID 를 넣으세요")
  const res = await openFileObject(f)
  const chunks: Buffer[] = []
  for await (const chunk of res.body) chunks.push(Buffer.from(chunk))
  let read
  try {
    read = await readInvoiceSource(Buffer.concat(chunks), f.name, f.mimeType, caller.userId)
  } catch (err) {
    if (err instanceof ImportUserError) return blocked(T, f.name, err.message)
    console.error("[import_tax_invoice] 판독 실패", { name: f.name, err })
    return blocked(T, f.name, "읽지 못했습니다. 홈택스에서 받은 엑셀이나 PDF 인지 확인해 주세요")
  }
  const skip = new Set(Array.isArray(args.skip) ? args.skip.map(String) : [])
  const base = { twinIsDifferent: args.twin_is_different === true, keepOriginal: args.keep_original === true, acceptVision: args.accept_vision === true }
  const decisions: ImportDecisions = {}
  const orgs = await loadOrgsForMatching()
  const rows: { label: string; before: string | null; after: string }[] = []
  const problems: string[] = []
  let saveable = 0
  for (const invoice of read.invoices) {
    const key = invoice.approvalNo ?? ""
    if (key) decisions[key] = { ...base, ...(skip.has(key) ? { skip: true } : {}) }
    const plan = await planInvoice(invoice, orgs, { hasFile: read.source === "pdf" })
    const blockers = saveBlockers(invoice, plan, base)
    const visionBlock = invoice.readBy === "vision" && !base.acceptVision ? ["AI 가 읽었습니다 — 원본과 대조했다면 accept_vision=true"] : []
    const why = skip.has(key) ? ["건너뜀"] : [...blockers, ...visionBlock]
    if (why.length === 0) saveable++
    else if (!skip.has(key)) problems.push(`${key || "(승인번호 없음)"}: ${why.join(" · ")}`)
    rows.push({
      label: `${plan.counterName ?? "?"} · ${invoice.issuedOn ?? "?"}`,
      before: null,
      after: [
        `${invoice.direction === "SALE" ? "매출" : invoice.direction === "PURCHASE" ? "매입" : "?"} · 합계 ${invoice.totalKrw !== null ? won(invoice.totalKrw) : "?"}`,
        `승인번호 ${key || "?"}`,
        plan.org ? `기관 ${plan.org.name}` : "새 기관으로 만듦",
        plan.quote ? `견적 ${plan.quote.code}` : null,
        plan.attachToId ? "있는 기록에 PDF 만 붙임" : null,
        invoice.readBy === "vision" ? "AI 판독" : null,
        why.length ? `저장 안 함 — ${why.join(" · ")}` : null,
      ].filter(Boolean).join(" · "),
    })
  }
  return {
    title: T, target: `${f.name} · ${read.source === "excel" ? "홈택스 엑셀" : "PDF · 사진"} ${read.invoices.length}장`,
    changes: rows.slice(0, 40),
    risk: "세금계산서가 매출 · 매입에 들어가고 기관 · 견적에 이어집니다. 없는 기관은 새로 생깁니다. 활동 기록에 남습니다.",
    ...(problems.length ? { warning: `저장하지 않을 장: ${problems.slice(0, 5).join(" / ")}` } : {}),
    ...(saveable === 0 ? { problem: problems.length ? `저장할 수 있는 장이 없습니다 — ${problems.slice(0, 3).join(" / ")}` : "저장할 장이 없습니다" } : {}),
    run: async () => {
      const results = await importInvoices(read, f.name, decisions, caller.userId)
      const n = (s: string) => results.filter((r) => r.status === s).length
      return { ok: true, text: `저장 ${n("saved")} · PDF 붙임 ${n("attached")} · 건너뜀 ${n("skipped")} · 실패 ${n("failed")}${n("failed") ? `\n${results.filter((r) => r.status === "failed").map((r) => `- ${r.approvalNo}: ${r.message}`).join("\n")}` : ""}` }
    },
  }
}

export const CRM_MORE_PLANNERS: Record<CrmMoreWriteName, Planner> = {
  delete_stock_move: planDeleteStockMove,
  delete_payment: planDeletePayment,
  settle_payments: planSettle,
  create_contact: planCreateContact,
  decide_inquiry: planDecideInquiry,
  link_tax_invoice: planLinkInvoice,
  delete_tax_invoice: planDeleteInvoice,
  import_tax_invoice: planImportInvoice,
}

export type { Caller }
