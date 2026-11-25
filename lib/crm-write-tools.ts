// CRM 고치기 도구의 서버 쪽 — 계획(lib/crm-write-rules.ts)에 DB 를 붙이고, 확인되면 화면 API 와 같은 함수(lib/crm-ops.ts)로 쓴다.
// MCP runTool · 앱 AI 확인 카드(lib/agent/tools.ts) · 질문 경로 미리보기가 모두 여기를 지난다.
import { prisma } from "@/lib/db"
import { writeActivity } from "@/lib/api"
import { normalizeOrgName } from "@/lib/crm-sample-rules"
import { listProductsWithStock } from "@/lib/crm-sample-server"
import {
  createOrg, createPayment, createProduction, createQuote, createShipment, createStockMove, deleteProduction, deleteQuote, deleteSampleRequest, deleteShipment,
  planProductionInput, updateOrg, updateProduction, updateQuote, updateSampleRequest, updateShipment, type OpResult,
} from "@/lib/crm-ops"
import { amountText, rowProductLabel, variantLabel } from "@/lib/crm-gel"
import { receivableChains } from "@/lib/crm-receivables"
import { QUOTE_STATUS_LABEL, quoteTotals, SHIPMENT_KIND_LABEL, SHIPMENT_STATUS_LABEL } from "@/lib/crm"
import {
  crmPlanText, planCrmWrite, type CrmOp, type CrmPlan, type CrmPort, type CrmProductionView, type CrmQuoteView, type CrmReceivableView, type CrmSampleView, type CrmShipmentView, type CrmWriteToolName,
} from "@/lib/crm-write-rules"

const kst = (d: Date) => d.toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 10)

async function sampleView(ref: string): Promise<CrmSampleView | null> {
  const key = ref.trim()
  const uuid = /^[0-9a-f-]{36}$/i.test(key)
  const s = await prisma.crmSampleRequest.findFirst({
    where: uuid ? { id: key } : { code: { equals: key, mode: "insensitive" } },
    include: { org: { select: { id: true, name: true } }, shipments: { select: { id: true, code: true, quantity: true, productId: true, concentrationPct: true, volumeMl: true }, orderBy: { createdAt: "asc" } } },
  })
  if (!s) return null
  const n = (v: unknown) => (v == null ? null : Number(v))
  return {
    id: s.id, code: s.code, date: kst(s.requestedAt), org: s.org, productId: s.productId,
    request: s.request, referral: s.referral, note: s.note, sent: s.status === "SENT",
    shipments: s.shipments.map((x) => ({ ...x, concentrationPct: n(x.concentrationPct), volumeMl: n(x.volumeMl) })),
    concentrationPct: n(s.concentrationPct), volumeMl: n(s.volumeMl),
  }
}

const productionInclude = {
  product: { select: { name: true } },
  material: { select: { name: true } },
}

async function productionView(ref: string): Promise<CrmProductionView | null> {
  const key = ref.trim()
  const p = await prisma.crmProduction.findFirst({
    where: isUuid(key) ? { id: key } : { code: { equals: key, mode: "insensitive" } },
    include: productionInclude,
  })
  if (!p) return null
  return {
    id: p.id, code: p.code, date: kst(p.producedAt), productId: p.productId, productName: p.product.name,
    concentrationPct: p.concentrationPct != null ? Number(p.concentrationPct) : null,
    totalMl: Number(p.totalMl ?? 0), materialId: p.materialId, materialName: p.material?.name ?? null,
    materialGrams: Number(p.materialGrams), note: p.note, photoFileIds: p.photoFileIds,
  }
}

/** list_productions — production_id 를 여기서 고른다 */
export async function productionListText(query?: string, limit = 20): Promise<string> {
  const take = Math.min(Math.max(limit || 20, 1), 50)
  const q = (query ?? "").trim()
  const rows = await prisma.crmProduction.findMany({
    where: q ? { OR: [{ code: { contains: q, mode: "insensitive" } }, { note: { contains: q, mode: "insensitive" } }, { product: { name: { contains: q, mode: "insensitive" } } }] } : {},
    orderBy: { producedAt: "desc" }, take, include: productionInclude,
  })
  if (rows.length === 0) return q ? `'${q}' 에 맞는 생산 기록이 없습니다.` : "생산 기록이 없습니다."
  return [
    `CRM 생산 기록 ${rows.length}건(최근순) — 고치기 · 지우기는 production_id 로 update_production · delete_production.`,
    ...rows.map((p) => [
      `- production_id=${p.id}`, p.code, kst(p.producedAt),
      variantLabel(p.product.name, p.concentrationPct != null ? Number(p.concentrationPct) : null, Number(p.totalMl ?? 0)),
      p.material ? `${p.material.name} −${Number(p.materialGrams)}g` : "원재료 차감 없음",
      p.photoFileIds.length ? `사진 ${p.photoFileIds.length}장` : null,
      p.note ? `메모 ${p.note.slice(0, 80)}` : null,
    ].filter(Boolean).join(" · ")),
  ].join("\n")
}

const isUuid = (k: string) => /^[0-9a-f-]{36}$/i.test(k)

const shipmentInclude = {
  org: { select: { id: true, name: true, code: true } },
  product: { select: { name: true, spec: true, gelType: true } },
  sampleRequest: { select: { code: true } },
  _count: { select: { stockMoves: true } },
} as const

async function shipmentView(ref: string): Promise<CrmShipmentView | null> {
  const key = ref.trim()
  const s = await prisma.crmShipment.findFirst({
    where: isUuid(key) ? { id: key } : { code: { equals: key, mode: "insensitive" } },
    include: shipmentInclude,
  })
  if (!s) return null
  return {
    id: s.id, code: s.code, date: kst(s.shippedAt), kind: s.kind, status: s.status, org: { id: s.org.id, name: s.org.name },
    productId: s.productId, concentrationPct: s.concentrationPct != null ? Number(s.concentrationPct) : null,
    volumeMl: s.volumeMl != null ? Number(s.volumeMl) : null, quantity: s.quantity, note: s.note,
    ledger: s._count.stockMoves > 0, sampleCode: s.sampleRequest?.code ?? null,
  }
}

/** list_shipments — shipment_id 를 여기서 고른다 */
export async function shipmentListText(query?: string, limit = 20): Promise<string> {
  const take = Math.min(Math.max(limit || 20, 1), 50)
  const q = (query ?? "").trim()
  const rows = await prisma.crmShipment.findMany({
    where: q ? { OR: [
      { code: { contains: q, mode: "insensitive" } }, { note: { contains: q, mode: "insensitive" } },
      { org: { name: { contains: q, mode: "insensitive" } } }, { org: { code: { equals: q, mode: "insensitive" } } },
      { product: { name: { contains: q, mode: "insensitive" } } },
    ] } : {},
    orderBy: [{ shippedAt: "desc" }, { createdAt: "desc" }], take, include: shipmentInclude,
  })
  if (rows.length === 0) return q ? `'${q}' 에 맞는 출고가 없습니다.` : "출고 기록이 없습니다."
  return [
    `CRM 출고 ${rows.length}건(최근순) — 고치기 · 지우기는 shipment_id 로 update_shipment · delete_shipment.`,
    ...rows.map((s) => [
      `- shipment_id=${s.id}`, s.code, kst(s.shippedAt), `${s.org.name}(${s.org.code})`,
      `${rowProductLabel(s.product, { concentrationPct: s.concentrationPct })} ${amountText(s, s.product.gelType)}`,
      SHIPMENT_KIND_LABEL[s.kind], SHIPMENT_STATUS_LABEL[s.status],
      s._count.stockMoves > 0 ? "재고 차감됨" : "미반영(재고 무관)",
      s.sampleRequest ? `샘플요청 ${s.sampleRequest.code}` : null,
      s.note ? `비고 ${s.note.slice(0, 80)}` : null,
    ].filter(Boolean).join(" · ")),
  ].join("\n")
}

const label = (p: { name: string; spec: string | null; gelType?: string | null }, row?: { concentrationPct?: unknown; volumeMl?: unknown }) => rowProductLabel(p, row)

async function quoteView(ref: string): Promise<CrmQuoteView | null> {
  const key = ref.trim()
  const q = await prisma.crmQuote.findFirst({
    where: isUuid(key) ? { id: key } : { code: { equals: key, mode: "insensitive" } },
    include: {
      org: { select: { id: true, name: true } },
      items: { include: { product: { select: { name: true, spec: true, gelType: true } } }, orderBy: { sortOrder: "asc" } },
      _count: { select: { shipments: true, taxInvoices: true } },
    },
  })
  if (!q) return null
  return {
    id: q.id, code: q.code, date: kst(q.quotedAt), org: q.org, status: q.status, note: q.note, discount: q.discountAmount, vatRate: q.vatRate,
    items: q.items.map((i) => ({ productId: i.productId, label: label(i.product, i), quantity: i.quantity, unitPrice: i.unitPrice })),
    shipments: q._count.shipments, taxInvoices: q._count.taxInvoices,
    taxInvoicedAt: q.taxInvoicedAt ? kst(q.taxInvoicedAt) : null,
  }
}

/** 세금계산서 묶음의 남은 금액 — 화면(미수금)과 같은 receivableChains */
async function receivableView(ref: string): Promise<CrmReceivableView | null> {
  const key = ref.trim()
  const inv = await prisma.taxInvoice.findFirst({
    where: isUuid(key) ? { id: key } : { approvalNo: key },
    select: { id: true, direction: true, approvalNo: true, originalApprovalNo: true },
  })
  if (!inv) return null
  const root = inv.originalApprovalNo ?? inv.approvalNo
  const c = (await receivableChains(inv.direction)).find((x) => x.approvalNo === root || x.invoiceId === inv.id)
  if (!c) return null
  return { invoiceId: c.invoiceId, approvalNo: c.approvalNo, direction: inv.direction, who: c.counterName, issuedOn: c.issuedOn, total: c.total, paid: c.paid, remaining: c.remaining }
}

/** 계획이 읽는 CRM — 운영 DB */
export const prismaCrmPort: CrmPort = {
  async products() {
    const [rows, extra] = await Promise.all([
      listProductsWithStock(),
      prisma.crmProduct.findMany({ where: { archived: false }, select: { id: true, isMaterial: true, volumeMl: true, concentrationPct: true, unitPrice: true } }),
    ])
    const by = new Map(extra.map((e) => [e.id, e]))
    return rows.map((r) => {
      const e = by.get(r.id)
      return { ...r, isMaterial: e?.isMaterial ?? false, volumeMl: e?.volumeMl ? Number(e.volumeMl) : null, concentrationPct: e?.concentrationPct ? Number(e.concentrationPct) : null, unitPrice: e?.unitPrice ?? null }
    })
  },
  orgs: () => prisma.crmOrg.findMany({ select: { id: true, code: true, name: true, type: true, address: true, note: true, billingOrgId: true } }),
  sample: sampleView,
  quote: quoteView,
  receivable: receivableView,
  production: productionView,
  shipment: shipmentView,
  async productionPreview(input, excludeId) {
    const r = await planProductionInput({ ...input, producedAt: `${input.producedAt}T00:00:00Z` }, excludeId)
    if (!r.ok) return { problem: r.error }
    const v = r.value
    return {
      productId: v.product.id, productName: v.product.name, conc: v.conc, totalMl: v.totalMl,
      materialId: v.material?.id ?? null, materialName: v.material?.name ?? null, materialGrams: v.materialGrams,
      materialBefore: v.material?.grams ?? 0, warnings: v.warnings,
    }
  },
}

export const planCrm = (name: CrmWriteToolName, args: Record<string, unknown>) => planCrmWrite(name, args, prismaCrmPort)

async function runOp(op: CrmOp, userId: string): Promise<OpResult<{ id: string; text: string }>> {
  switch (op.kind) {
    case "createQuote": {
      const r = await createQuote({ ...op.input, quotedAt: `${op.input.quotedAt}T00:00:00Z` })
      if (!r.ok) return r
      return { ok: true, value: { id: r.value.id, text: `만들었습니다: 견적 ${r.value.code} · 합계 ${r.value.totals.total.toLocaleString("ko-KR")}원` } }
    }
    case "updateQuote": {
      const actor = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } })
      const r = await updateQuote(op.id, op.input, { id: userId, name: actor?.name })
      if (!r.ok) return r
      return { ok: true, value: { id: op.id, text: `고쳤습니다: 견적 ${r.value.code}` } }
    }
    case "deleteQuote": {
      const r = await deleteQuote(op.id)
      if (!r.ok) return r
      return { ok: true, value: { id: op.id, text: `지웠습니다: 견적 ${r.value.code}` } }
    }
    case "shipment": {
      const r = await createShipment({ ...op.input, shippedAt: `${op.input.shippedAt}T00:00:00Z` })
      if (!r.ok) return r
      return { ok: true, value: { id: r.value.id, text: `출고 ${r.value.code} 를 남겼습니다 — 재고에서 뺐습니다.` } }
    }
    case "updateShipment": {
      const input = { ...op.input, ...(typeof op.input.shippedAt === "string" ? { shippedAt: `${op.input.shippedAt}T00:00:00Z` } : {}) }
      const r = await updateShipment(op.id, input)
      if (!r.ok) return r
      return { ok: true, value: { id: op.id, text: `고쳤습니다: 출고 ${r.value.code} — ${r.value.summary}.${r.value.ledger ? " 재고를 다시 계산했습니다." : " 미반영 출고라 재고는 그대로입니다."}` } }
    }
    case "deleteShipment": {
      const r = await deleteShipment(op.id)
      if (!r.ok) return r
      return { ok: true, value: { id: op.id, text: `지웠습니다: 출고 ${r.value.code} — ${r.value.summary}.${r.value.ledger ? " 재고가 돌아왔습니다." : ""}` } }
    }
    case "payment": {
      const r = await createPayment(op.input, userId)
      if (!r.ok) return r
      return { ok: true, value: { id: r.value.id, text: `적었습니다${r.value.remaining !== null ? ` — 남은 금액 ${r.value.remaining.toLocaleString("ko-KR")}원` : ""}.` } }
    }
    case "updateSample": {
      const r = await updateSampleRequest(op.id, op.input)
      if (!r.ok) return r
      const v = r.value
      return { ok: true, value: { id: op.id, text: [
        `고쳤습니다: 샘플요청 ${v.code}`,
        v.shipment ? `샘플 출고 ${v.shipment.code} · ${amountText({ quantity: v.shipment.quantity, volumeMl: v.shipment.ml }, v.shipment.ml != null ? "gel" : null)} — 재고가 따라 바뀌었습니다` : null,
        v.removedShipment ? `샘플 출고 ${v.removedShipment} 를 지웠습니다 — 재고가 돌아왔습니다` : null,
      ].filter(Boolean).join("\n") } }
    }
    case "deleteSample": {
      const r = await deleteSampleRequest(op.id, { withShipments: op.withShipments })
      if (!r.ok) return r
      return { ok: true, value: { id: op.id, text: [
        `지웠습니다: 샘플요청 ${r.value.code}`,
        r.value.shipments.length ? `샘플 출고 ${r.value.shipments.join(", ")} 도 지워 재고가 돌아왔습니다` : null,
      ].filter(Boolean).join("\n") } }
    }
    case "createOrg": {
      const r = await createOrg(op.input)
      if (!r.ok) return r
      return { ok: true, value: { id: r.value.id, text: `만들었습니다: 기관 ${r.value.code} ${r.value.name}` } }
    }
    case "updateOrg": {
      const r = await updateOrg(op.id, op.input)
      if (!r.ok) return r
      return { ok: true, value: { id: r.value.id, text: `고쳤습니다: 기관 ${r.value.code} ${r.value.name}` } }
    }
    case "stockMove": {
      const r = await createStockMove({ ...op.input, movedAt: `${op.input.movedAt}T00:00:00Z` })
      if (!r.ok) return r
      return { ok: true, value: { id: r.value.id, text: "재고 장부에 적었습니다." } }
    }
    case "production": {
      const r = await createProduction({ ...op.input, producedAt: `${op.input.producedAt}T00:00:00Z` })
      if (!r.ok) return r
      return { ok: true, value: { id: r.value.id, text: `생산 ${r.value.code} 를 남겼습니다 — ${r.value.summary}. 완제품 재고가 늘고${r.value.materialName ? ` ${r.value.materialName} ${r.value.materialGrams}g 이 줄었습니다` : " 원재료는 차감하지 않았습니다"}.` } }
    }
    case "updateProduction": {
      const r = await updateProduction(op.id, { ...op.input, producedAt: `${op.input.producedAt}T00:00:00Z` })
      if (!r.ok) return r
      return { ok: true, value: { id: op.id, text: `고쳤습니다: 생산 ${r.value.code} — ${r.value.summary}. 재고 · 원재료 차감을 다시 계산했습니다.` } }
    }
    case "deleteProduction": {
      const r = await deleteProduction(op.id)
      if (!r.ok) return r
      return { ok: true, value: { id: op.id, text: `지웠습니다: 생산 ${r.value.code} — 완제품 재고를 빼고 원재료를 돌려놓았습니다.` } }
    }
  }
}

/**
 * CRM 고치기 도구 실행. confirm 이 없으면 계획만 돌려준다(MCP · 질문 경로 미리보기).
 * 앱 AI 는 확인 카드를 누른 뒤 confirm=true 로 여기를 부른다 — 계획을 다시 세워 그 사이 바뀐 것을 반영한다.
 */
export async function runCrmWrite(name: CrmWriteToolName, args: Record<string, unknown>, userId: string): Promise<{ text: string } | { error: string }> {
  const plan = await planCrm(name, args)
  if (plan.problem || !plan.op) return { error: plan.problem ?? "입력을 읽지 못했습니다." }
  if (args.confirm !== true) {
    return { text: `아직 쓰지 않았습니다. 아래 내용을 사용자에게 보여 주고 동의를 받은 뒤 confirm=true 로 다시 부르세요.\n${crmPlanText(plan)}` }
  }
  const r = await runOp(plan.op, userId)
  if (!r.ok) return { error: r.error }
  if (plan.done) {
    await writeActivity({
      userId, action: plan.done.action, entity: plan.done.entity, entityId: r.value.id, title: plan.done.title,
      metadata: { from: name, changes: plan.changes.map((c) => ({ label: c.label, before: c.before, after: c.after })) },
    })
  }
  return { text: `${r.value.text}\n${plan.changes.map((c) => `- ${c.label}: ${c.before !== null ? `${c.before} → ${c.after}` : c.after}`).join("\n")}` }
}

export type { CrmPlan }

/** list_samples — sample_id 를 여기서 고른다 */
export async function sampleListText(query?: string, limit = 20): Promise<string> {
  const take = Math.min(Math.max(limit || 20, 1), 50)
  const rows = await prisma.crmSampleRequest.findMany({
    orderBy: [{ requestedAt: "desc" }, { createdAt: "desc" }],
    take: query ? 500 : take,
    include: {
      org: { select: { name: true, code: true } },
      product: { select: { name: true, spec: true, gelType: true } },
      shipments: { select: { code: true, quantity: true, volumeMl: true, product: { select: { name: true, spec: true, gelType: true } } } },
    },
  })
  const q = query ? normalizeOrgName(query) : ""
  const hit = q
    ? rows.filter((s) => [s.code, s.org.name, s.org.code, s.product ? `${s.product.name}${s.product.spec ?? ""}` : "", s.request ?? ""].some((k) => normalizeOrgName(k).includes(q))).slice(0, take)
    : rows
  if (hit.length === 0) return query ? `'${query}' 에 맞는 샘플요청이 없습니다.` : "샘플요청이 없습니다."
  return [
    `샘플요청 ${hit.length}건(최근 것부터) — 고치기 · 지우기는 sample_id 로(update_sample · delete_sample).`,
    ...hit.map((s) => [
      `- sample_id=${s.id}`, s.code, kst(s.requestedAt), `${s.org.name}(${s.org.code})`,
      s.product ? rowProductLabel(s.product, s) : "제품 없음",
      s.shipments.length ? `출고 ${s.shipments.map((x) => `${x.code} ${amountText(x, x.product.gelType)}`).join(", ")}` : "출고 없음",
      s.status === "SENT" ? "발송완료" : "미발송",
      s.request ? `요청 ${s.request.slice(0, 60)}` : null,
    ].filter(Boolean).join(" · ")),
  ].join("\n")
}

/** list_quotes — quote_id 를 여기서 고른다 */
export async function quoteListText(query?: string, limit = 20): Promise<string> {
  const take = Math.min(Math.max(limit || 20, 1), 50)
  const rows = await prisma.crmQuote.findMany({
    orderBy: [{ quotedAt: "desc" }, { createdAt: "desc" }],
    take: query ? 500 : take,
    include: {
      org: { select: { name: true, code: true } },
      items: { include: { product: { select: { name: true, spec: true, gelType: true } } }, orderBy: { sortOrder: "asc" } },
      _count: { select: { taxInvoices: true, shipments: true } },
    },
  })
  const q = query ? normalizeOrgName(query) : ""
  const hit = q
    ? rows.filter((x) => [x.code, x.org.name, x.org.code, ...x.items.map((i) => `${i.product.name}${i.product.spec ?? ""}`)].some((k) => normalizeOrgName(k).includes(q))).slice(0, take)
    : rows
  if (hit.length === 0) return query ? `'${query}' 에 맞는 견적이 없습니다.` : "견적이 없습니다."
  return [
    `견적 ${hit.length}건(최근 것부터) — 고치기 · 지우기는 quote_id 로(update_quote · delete_quote).`,
    ...hit.map((x) => [
      `- quote_id=${x.id}`, x.code, kst(x.quotedAt), `${x.org.name}(${x.org.code})`,
      x.items.map((i) => `${label(i.product, i)} ${i.quantity}개 × ${i.unitPrice.toLocaleString("ko-KR")}원`).join(", "),
      `합계 ${quoteTotals(x.items, x.discountAmount, x.vatRate).total.toLocaleString("ko-KR")}원`,
      QUOTE_STATUS_LABEL[x.status],
      x._count.taxInvoices ? `세금계산서 ${x._count.taxInvoices}장` : "세금계산서 없음",
      x._count.shipments ? `출고 ${x._count.shipments}건` : null,
    ].filter(Boolean).join(" · ")),
  ].join("\n")
}

/** list_receivables — invoice_id 를 여기서 고른다(화면 미수금과 같은 receivableChains) */
export async function receivableListText(args: Record<string, unknown>): Promise<string> {
  const direction = args.direction === "PURCHASE" ? "PURCHASE" : "SALE"
  const q = typeof args.query === "string" && args.query.trim() ? normalizeOrgName(args.query) : ""
  const all = await receivableChains(direction)
  const rows = all
    .filter((c) => args.include_paid === true || c.remaining > 0)
    .filter((c) => !q || [c.counterName, c.approvalNo, c.quote?.code ?? ""].some((k) => normalizeOrgName(k).includes(q)))
    .slice(0, 50)
  const word = direction === "SALE" ? "받은" : "준"
  if (rows.length === 0) return direction === "SALE" ? "받을 돈이 남은 세금계산서가 없습니다." : "줄 돈이 남은 세금계산서가 없습니다."
  return [
    `세금계산서 ${rows.length}장(${direction === "SALE" ? "매출 — 받을 돈" : "매입 — 줄 돈"}) — 입금은 invoice_id 로(record_payment).`,
    ...rows.map((c) => [
      `- invoice_id=${c.invoiceId}`, c.counterName, `${c.issuedOn} 발행`, `합계 ${c.total.toLocaleString("ko-KR")}원`,
      `${word} ${c.paid.toLocaleString("ko-KR")}원`, `남은 ${c.remaining.toLocaleString("ko-KR")}원`,
      c.quote ? `견적 ${c.quote.code}` : null, `승인번호 ${c.approvalNo}`,
    ].filter(Boolean).join(" · ")),
  ].join("\n")
}
